use crate::model::{es, Backend, ConnInfo, DbType};
use std::time::Duration;

fn req<'a>(v: &'a Option<String>, msg: &str) -> Result<&'a str, String> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| msg.to_string())
}

/// postgres 连接串里的值用单引号包裹,转义反斜杠和单引号
fn pg_quote(v: &str) -> String {
    format!("'{}'", v.replace('\\', "\\\\").replace('\'', "\\'"))
}

pub async fn connect(info: &ConnInfo) -> Result<Backend, String> {
    match info.db_type {
        DbType::Sqlite => {
            let path = req(&info.file_path, "缺少 SQLite 数据库文件路径")?;
            let conn = rusqlite::Connection::open(path)
                .map_err(|e| format!("打开 SQLite 文件失败: {e}"))?;
            let _ = conn.busy_timeout(Duration::from_secs(5));
            // WAL 失败(比如内存库/网络盘)不影响使用
            let _ = conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get::<_, String>(0));
            let _ = conn.execute_batch("PRAGMA foreign_keys=ON");
            conn.query_row("SELECT 1", [], |r| r.get::<_, i64>(0))
                .map_err(|e| format!("该文件不是有效的 SQLite 数据库: {e}"))?;
            Ok(Backend::Sqlite(conn))
        }
        DbType::MySql => {
            let host = req(&info.host, "缺少主机地址")?;
            let port = info.port.unwrap_or(3306);
            let user = req(&info.user, "缺少用户名")?;
            let pass = info.password.as_deref().unwrap_or("");
            let db = info.database.as_deref().map(str::trim).filter(|s| !s.is_empty());
            let opts = mysql_async::OptsBuilder::default()
                .ip_or_hostname(host)
                .tcp_port(port)
                .user(Some(user))
                .pass(Some(pass))
                .db_name(db);
            let conn = mysql_async::Conn::new(opts)
                .await
                .map_err(|e| format!("连接 MySQL 失败: {e}"))?;
            Ok(Backend::MySql(conn))
        }
        DbType::Redis => {
            let host = req(&info.host, "缺少主机地址")?;
            let port = info.port.unwrap_or(6379);
            let pass = info.password.as_deref();
            let db_idx: i64 = info
                .database
                .as_deref()
                .and_then(|d| d.trim().parse().ok())
                .unwrap_or(0);
            let auth = pass.map(|p| format!(":{p}@")).unwrap_or_default();
            let url = format!("redis://{auth}{host}:{port}/{db_idx}");
            let client = redis::Client::open(url).map_err(|e| format!("Redis 地址无效: {e}"))?;
            // 试连 + PING
            let mut con = client
                .get_async_connection()
                .await
                .map_err(|e| format!("连接 Redis 失败: {e}"))?;
            redis::cmd("PING")
                .query_async::<String>(&mut con)
                .await
                .map_err(|e| format!("Redis PING 失败: {e}"))?;
            Ok(Backend::Redis(client))
        }
        DbType::Postgres => {
            let host = req(&info.host, "缺少主机地址")?;
            let port = info.port.unwrap_or(5432);
            let user = req(&info.user, "缺少用户名")?;
            let pass = info.password.as_deref().unwrap_or("");
            // 数据库可选:不填默认连 postgres 库
            let db = info.database.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or("postgres");
            let cfg = format!(
                "host={} port={} user={} password={} dbname={} connect_timeout=8 application_name=数镜",
                pg_quote(host),
                port,
                pg_quote(user),
                pg_quote(pass),
                pg_quote(db)
            );
            let (client, connection) = tokio_postgres::connect(&cfg, tokio_postgres::NoTls)
                .await
                .map_err(|e| format!("连接 PostgreSQL 失败: {e}"))?;
            // 后台驱动连接任务,断开时打日志即可
            tokio::spawn(async move {
                if let Err(e) = connection.await {
                    eprintln!("[postgres] 连接中断: {e}");
                }
            });
            Ok(Backend::Pg(client))
        }
    }
}

impl Backend {
    pub async fn server_info(&mut self) -> Result<String, String> {
        match self {
            Backend::Sqlite(_) => Ok(format!("SQLite {}", rusqlite::version())),
            Backend::MySql(conn) => {
                use mysql_async::prelude::*;
                let mut result = conn.query_iter("SELECT VERSION()").await.map_err(es)?;
                let mut version = String::new();
                result
                    .for_each(|row| {
                        if version.is_empty() {
                            if let Some(v) = row.unwrap().first() {
                                if let Some(s) = crate::exec::fmt_mysql_value(v) {
                                    version = s;
                                }
                            }
                        }
                    })
                    .await
                    .map_err(es)?;
                Ok(if version.is_empty() { "MySQL".into() } else { version })
            }
            Backend::Redis(client) => {
                let mut con = client
                    .get_async_connection()
                    .await
                    .map_err(es)?;
                let info_txt: String = redis::cmd("INFO")
                    .arg("server")
                    .query_async(&mut con)
                    .await
                    .map_err(es)?;
                let ver = info_txt
                    .lines()
                    .find(|l| l.starts_with("redis_version:"))
                    .map(|l| l.to_string())
                    .unwrap_or_else(|| "Redis".into());
                Ok(format!("Redis {ver}"))
            }
            Backend::Pg(client) => {
                let rows = client.simple_query("SELECT version()").await.map_err(es)?;
                for msg in rows {
                    if let tokio_postgres::SimpleQueryMessage::Row(row) = msg {
                        if let Some(v) = row.get(0) {
                            return Ok(v.to_string());
                        }
                    }
                }
                Ok("PostgreSQL".into())
            }
        }
    }
}
