mod backend;
mod edits;
mod exec;
mod model;
mod redis_ops;
mod schema;
mod search;
mod store;

use model::{AppState, ConnInfo, ConnectResult, LiveConn, TableMeta, TableStructure};
use tauri::{AppHandle, State};

#[tauri::command]
async fn list_saved_connections(app: AppHandle) -> Result<Vec<ConnInfo>, String> {
    Ok(store::load_conns(&app))
}

/// 新增或更新连接,返回保存后的完整列表
#[tauri::command]
async fn save_connection(app: AppHandle, state: State<'_, AppState>, info: ConnInfo) -> Result<Vec<ConnInfo>, String> {
    let mut conns = store::load_conns(&app);
    conns.retain(|c| c.id != info.id);
    conns.push(info.clone());
    store::save_conns(&app, &conns)?;
    // 若该连接已在线且配置变了,断开旧连接让用户重连
    state.inner().remove(&info.id);
    Ok(conns)
}

#[tauri::command]
async fn delete_connection(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<Vec<ConnInfo>, String> {
    state.inner().remove(&id);
    let mut conns = store::load_conns(&app);
    conns.retain(|c| c.id != id);
    store::save_conns(&app, &conns)?;
    Ok(conns)
}

#[tauri::command]
async fn test_connection(info: ConnInfo) -> Result<ConnectResult, String> {
    let mut backend = backend::connect(&info).await?;
    let version = backend.server_info().await?;
    Ok(ConnectResult { version })
}

#[tauri::command]
async fn connect(state: State<'_, AppState>, info: ConnInfo) -> Result<ConnectResult, String> {
    let mut backend = backend::connect(&info).await?;
    let version = backend.server_info().await?;
    state.insert(LiveConn { info, backend });
    Ok(ConnectResult { version })
}

#[tauri::command]
async fn disconnect(state: State<'_, AppState>, id: String) -> Result<(), String> {
    // 直接移出连接表,引用清零后 TCP 连接随之关闭
    state.inner().remove(&id);
    Ok(())
}

#[tauri::command]
async fn list_tables(state: State<'_, AppState>, id: String) -> Result<Vec<TableMeta>, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    let info = guard.info.clone();
    guard.backend.list_tables(&info).await
}

#[tauri::command]
async fn get_table_structure(
    state: State<'_, AppState>,
    id: String,
    table: String,
) -> Result<TableStructure, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    let info = guard.info.clone();
    guard.backend.get_table_structure(&info, &table).await
}

#[tauri::command]
async fn count_rows(state: State<'_, AppState>, id: String, table: String) -> Result<u64, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    guard.backend.count_rows(&table).await
}

#[tauri::command]
async fn list_foreign_keys(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<schema::FkMeta>, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    let info = guard.info.clone();
    guard.backend.list_foreign_keys(&info).await
}

/// 构建单表 SQL 文本(结构 + 可选数据)
async fn build_table_dump(
    backend: &mut model::Backend,
    info: &model::ConnInfo,
    table: &str,
    with_data: bool,
) -> Result<(String, u64), String> {
    let mysql = info.db_type == model::DbType::MySql;
    let q = |s: &str| -> String {
        if mysql {
            format!("`{}`", s.replace('`', "``"))
        } else {
            format!("\"{}\"", s.replace('"', "\"\""))
        }
    };
    let lit = |v: Option<&str>| -> String {
        match v {
            None => "NULL".to_string(),
            Some(s) => format!("'{}'", s.replace('\'', "''")),
        }
    };
    let qt = q(&table);

    let mut out = String::new();
    out.push_str(&format!("-- 数镜 dump: table {qt}\n"));
    // 建表语句:SQLite/MySQL 用原生 DDL,PG 简化合成
    match backend.get_table_structure(info, table).await {
        Ok(st) if !st.ddl.is_empty() => {
            out.push_str(&st.ddl.trim_end_matches(';'));
            out.push_str(";\n\n");
        }
        Ok(st) if !st.columns.is_empty() => {
            let cols = st
                .columns
                .iter()
                .map(|c| {
                    let mut d = format!("  {} {}", q(&c.name), c.data_type);
                    if !c.nullable {
                        d.push_str(" NOT NULL");
                    }
                    if let Some(def) = &c.default {
                        d.push_str(&format!(" DEFAULT {}", def));
                    }
                    d
                })
                .collect::<Vec<_>>()
                .join(",\n");
            out.push_str(&format!("CREATE TABLE {qt} (\n{cols}\n); -- 由 数镜 按列定义简化生成\n\n"));
        }
        _ => {}
    }
    let mut exported: u64 = 0;
    const BATCH: usize = 500;
    let mut offset: usize = 0;
    let mut cols_cache: Vec<String> = Vec::new();
    loop {
        if !with_data {
            break;
        }
        let sql = format!("SELECT * FROM {qt} LIMIT {BATCH} OFFSET {offset}");
        let r = backend.run_one(&sql, BATCH).await?;
        if r.columns.is_empty() || r.rows.is_empty() {
            break;
        }
        if cols_cache.is_empty() {
            cols_cache = r.columns.clone();
            let col_list = cols_cache.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
            out.push_str(&format!("INSERT INTO {qt} ({col_list}) VALUES\n"));
        }
        for row in &r.rows {
            let vals = row.iter().map(|c| lit(c.as_deref())).collect::<Vec<_>>().join(", ");
            out.push_str(&format!("({vals}),\n"));
            exported += 1;
        }
        offset += BATCH;
        if r.rows.len() < BATCH {
            break;
        }
        if exported > 1_000_000 {
            out.push_str("-- 超过 100 万行,导出中止\n");
            break;
        }
    }
    if exported > 0 {
        // 去掉末尾多余的分号前逗号
        let trimmed = out.trim_end().trim_end_matches(',');
        out = trimmed.to_string();
        out.push_str(";\n");
    } else if with_data {
        out.push_str("-- (空表)\n");
    }
    Ok((out, exported))
}

/// 导出内容(SQL 文本 + 行数),由前端负责落盘
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpResult {
    pub sql: String,
    pub rows: u64,
}

/// 导出整表 SQL(结构 + 可选数据)
#[tauri::command]
async fn export_table_sql(
    state: State<'_, AppState>,
    id: String,
    table: String,
    with_data: Option<bool>,
) -> Result<DumpResult, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    let info = guard.info.clone();
    let (sql, rows) =
        build_table_dump(&mut guard.backend, &info, &table, with_data.unwrap_or(true)).await?;
    Ok(DumpResult { sql, rows })
}

/// 导出整个数据库 SQL(所有表,结构 + 可选数据)
#[tauri::command]
async fn export_database_sql(
    state: State<'_, AppState>,
    id: String,
    with_data: Option<bool>,
) -> Result<DumpResult, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    let info = guard.info.clone();
    let tables = guard.backend.list_tables(&info).await?;
    let with_data = with_data.unwrap_or(true);
    let mut out = String::new();
    out.push_str(&format!(
        "-- 数镜 database dump\n-- tables: {}\n\n",
        tables.iter().filter(|t| t.kind == "table").count()
    ));
    let mut exported: u64 = 0;
    for t in tables.iter().filter(|t| t.kind == "table") {
        let (dump, n) = build_table_dump(&mut guard.backend, &info, &t.name, with_data).await?;
        out.push_str(&dump);
        out.push('\n');
        exported += n;
    }
    Ok(DumpResult { sql: out, rows: exported })
}

// ── Redis 专用命令 ────────────────────────────────────
#[tauri::command]
async fn redis_databases(state: State<'_, AppState>, id: String) -> Result<Vec<(u8, u64)>, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    redis_ops::databases(&mut guard.backend).await
}

#[tauri::command]
async fn redis_scan(
    state: State<'_, AppState>,
    id: String,
    db: u8,
    pattern: String,
    cursor: u64,
    count: Option<usize>,
) -> Result<(u64, Vec<String>), String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    redis_ops::scan_keys(&mut guard.backend, db, &pattern, cursor, count.unwrap_or(200)).await
}

#[tauri::command]
async fn redis_key_detail(
    state: State<'_, AppState>,
    id: String,
    db: u8,
    key: String,
) -> Result<redis_ops::RedisDetail, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    redis_ops::key_detail(&mut guard.backend, db, &key).await
}

#[tauri::command]
async fn redis_key_types(
    state: State<'_, AppState>,
    id: String,
    db: u8,
    keys: Vec<String>,
) -> Result<Vec<String>, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    redis_ops::key_types(&mut guard.backend, db, &keys).await
}

#[tauri::command]
async fn redis_del(state: State<'_, AppState>, id: String, db: u8, key: String) -> Result<u64, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    let info = guard.info.clone();
    if info.read_only {
        return Err("只读连接不允许删除".into());
    }
    redis_ops::del_key(&mut guard.backend, db, &key).await
}

#[tauri::command]
async fn redis_set(
    state: State<'_, AppState>,
    id: String,
    db: u8,
    key: String,
    value: String,
) -> Result<(), String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    let info = guard.info.clone();
    if info.read_only {
        return Err("只读连接不允许写入".into());
    }
    redis_ops::set_string(&mut guard.backend, db, &key, &value, true).await
}

#[tauri::command]
async fn redis_set_ttl(state: State<'_, AppState>, id: String, db: u8, key: String, seconds: i64) -> Result<(), String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    if guard.info.read_only { return Err("只读连接不允许修改 TTL".into()); }
    redis_ops::set_ttl(&mut guard.backend, db, &key, seconds).await
}

#[tauri::command]
async fn redis_rename(state: State<'_, AppState>, id: String, db: u8, key: String, new_key: String) -> Result<(), String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    if guard.info.read_only { return Err("只读连接不允许重命名".into()); }
    redis_ops::rename(&mut guard.backend, db, &key, &new_key).await
}

#[tauri::command]
async fn redis_ttl_batch(state: State<'_, AppState>, id: String, db: u8, keys: Vec<String>) -> Result<Vec<i64>, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    redis_ops::ttl_batch(&mut guard.backend, db, &keys).await
}

#[tauri::command]
async fn redis_new_key(
    state: State<'_, AppState>,
    id: String,
    db: u8,
    key: String,
    key_type: String,
    text: String,
    pairs: Vec<(String, String)>,
) -> Result<(), String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    if guard.info.read_only { return Err("只读连接不允许新建".into()); }
    redis_ops::new_key(&mut guard.backend, db, &key, &key_type, &text, &pairs).await
}

#[tauri::command]
async fn redis_member_op(
    state: State<'_, AppState>,
    id: String,
    db: u8,
    key: String,
    key_type: String,
    op: String,
    member: String,
    extra: String,
) -> Result<(), String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    if guard.info.read_only { return Err("只读连接不允许修改".into()); }
    redis_ops::member_op(&mut guard.backend, db, &key, &key_type, &op, &member, &extra).await
}

#[tauri::command]
async fn redis_analyze(
    state: State<'_, AppState>,
    id: String,
    db: u8,
    sample: Option<usize>,
    mode: String,
) -> Result<Vec<redis_ops::KeyStat>, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    redis_ops::analyze(&mut guard.backend, db, sample.unwrap_or(1000).min(20000), &mode).await
}

#[tauri::command]
async fn redis_run(
    state: State<'_, AppState>,
    id: String,
    command: String,
) -> Result<Vec<String>, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    let info = guard.info.clone();
    redis_ops::run_command(&mut guard.backend, &info, &command).await
}

/// 全局数据搜索:在连接的全部表中查找关键词
#[tauri::command]
async fn search_all_tables(
    state: State<'_, AppState>,
    id: String,
    keyword: String,
    max_hits: Option<usize>,
) -> Result<Vec<search::SearchHit>, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    let info = guard.info.clone();
    search::search_tables(&mut guard.backend, &info, &keyword, max_hits.unwrap_or(50)).await
}

#[tauri::command]
async fn get_object_ddl(
    state: State<'_, AppState>,
    id: String,
    kind: String,
    name: String,
) -> Result<String, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    let info = guard.info.clone();
    schema::object_ddl(&mut guard.backend, &info, &kind, &name).await
}

#[tauri::command]
async fn apply_changes(
    state: State<'_, AppState>,
    id: String,
    table: String,
    updates: Vec<edits::CellUpdate>,
    deletes: Vec<Vec<(String, String)>>,
    inserts: Vec<Vec<(String, String)>>,
) -> Result<model::ExecResult, String> {
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    let info = guard.info.clone();
    edits::apply_changes(&mut guard.backend, &info, &table, &updates, &deletes, &inserts).await
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入文件失败: {e}"))
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("读取文件失败: {e}"))
}

#[tauri::command]
fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| format!("写入文件失败: {e}"))
}

/// 返回多结果集(PostgreSQL 完整支持;MySQL/SQLite 返回第一个结果集)
#[tauri::command]
async fn run_sql(
    state: State<'_, AppState>,
    id: String,
    sql: String,
    max_rows: Option<usize>,
) -> Result<Vec<model::ExecResult>, String> {
    let sql = sql.trim().to_string();
    if sql.is_empty() {
        return Err("SQL 为空".into());
    }
    let live = state.inner().get(&id).ok_or("连接未建立或已断开")?;
    let mut guard = live.lock().await;
    if guard.info.read_only && !model::is_readonly_sql(&sql) {
        return Err("只读连接:仅允许 SELECT/WITH/EXPLAIN/SHOW/DESCRIBE/PRAGMA".into());
    }
    guard
        .backend
        .run_sql(&sql, max_rows.unwrap_or(exec::DEFAULT_MAX_ROWS))
        .await
}

#[cfg(test)]
mod tests {
    use crate::backend;
    use crate::edits;
    use crate::model;
    use crate::schema;
    use crate::search;
    use crate::model::{ConnInfo, DbType};

    fn sqlite_info(path: &str) -> ConnInfo {
        ConnInfo {
            id: "test".into(),
            name: "test".into(),
            db_type: DbType::Sqlite,
            host: None,
            port: None,
            user: None,
            password: None,
            database: None,
            file_path: Some(path.into()),
            color: None,
            read_only: false,
        }
    }

    fn tmp_db(tag: &str) -> String {
        let mut p = std::env::temp_dir();
        p.push(format!("dblens_test_{}_{tag}.db", std::process::id()));
        let _ = std::fs::remove_file(&p);
        p.to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn sqlite_full_flow() {
        let path = tmp_db("flow");
        let info = sqlite_info(&path);
        let mut b = backend::connect(&info).await.unwrap();

        // DDL + 批量插入
        b.run_sql("CREATE TABLE t1 (id INTEGER PRIMARY KEY, name TEXT, age INT)", 100)
            .await
            .unwrap();
        b.run_sql("CREATE INDEX idx_name ON t1(name)", 100).await.unwrap();
        let r = b.run_one(
            "INSERT INTO t1 (name, age) VALUES ('alice', 30), ('bob', 25), ('carol', NULL)",
            100,
        )
        .await
        .unwrap();
        assert_eq!(r.affected, 3);

        // 查询 + NULL 语义
        let r = b.run_one("SELECT id, name, age FROM t1 ORDER BY id", 100).await.unwrap();
        assert_eq!(r.columns, vec!["id", "name", "age"]);
        assert_eq!(r.rows.len(), 3);
        assert_eq!(r.rows[0][1].as_deref(), Some("alice"));
        assert_eq!(r.rows[2][2], None);

        // 表列表
        let tables = b.list_tables(&info).await.unwrap();
        assert!(tables.iter().any(|t| t.name == "t1" && t.kind == "table"));

        // 结构:主键 / 索引 / DDL
        let s = b.get_table_structure(&info, "t1").await.unwrap();
        assert_eq!(s.columns.len(), 3);
        assert_eq!(s.columns[0].key, "PRI");
        assert!(s.indexes.iter().any(|i| i.name == "idx_name" && !i.unique));
        assert!(s.ddl.contains("CREATE TABLE"));

        // 行数
        assert_eq!(b.count_rows("t1").await.unwrap(), 3);

        // 编辑回写 UPDATE
        let updates = vec![edits::CellUpdate {
            pk: vec![("id".into(), "1".into())],
            sets: vec![("age".into(), Some("31".into()))],
        }];
        let r = edits::apply_changes(&mut b, &info, "t1", &updates, &[], &[]).await.unwrap();
        assert_eq!(r.affected, 1);
        let r = b.run_one("SELECT age FROM t1 WHERE id = 1", 10).await.unwrap();
        assert_eq!(r.rows[0][0].as_deref(), Some("31"));

        // 删除行 DELETE
        let deletes = vec![vec![("id".into(), "2".into())]];
        edits::apply_changes(&mut b, &info, "t1", &[], &deletes, &[]).await.unwrap();
        assert_eq!(b.count_rows("t1").await.unwrap(), 2);

        // 置 NULL
        let updates = vec![edits::CellUpdate {
            pk: vec![("id".into(), "1".into())],
            sets: vec![("age".into(), None)],
        }];
        edits::apply_changes(&mut b, &info, "t1", &updates, &[], &[]).await.unwrap();
        let r = b.run_one("SELECT age FROM t1 WHERE id = 1", 10).await.unwrap();
        assert_eq!(r.rows[0][0], None);

        // 新增行 INSERT
        let inserts = vec![vec![
            ("name".to_string(), "dave".to_string()),
            ("age".to_string(), "40".to_string()),
        ]];
        edits::apply_changes(&mut b, &info, "t1", &[], &[], &inserts).await.unwrap();
        assert_eq!(b.count_rows("t1").await.unwrap(), 3);
        let r = b.run_one("SELECT name FROM t1 WHERE name = 'dave'", 10).await.unwrap();
        assert_eq!(r.rows.len(), 1);

        // max rows 截断
        let r = b.run_one("SELECT * FROM t1", 1).await.unwrap();
        assert_eq!(r.rows.len(), 1);
        assert!(r.truncated);

        // 无主键更新应报错
        b.run_sql("CREATE TABLE nopk (a TEXT)", 10).await.unwrap();
        let bad = edits::apply_changes(
            &mut b,
            &info,
            "nopk",
            &[edits::CellUpdate {
                pk: vec![],
                sets: vec![("a".into(), Some("x".into()))],
            }],
            &[],
            &[],
        )
        .await;
        assert!(bad.is_err());

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn sqlite_multi_statement_fallback() {
        let path = tmp_db("multi");
        let info = sqlite_info(&path);
        let mut b = backend::connect(&info).await.unwrap();
        // 多语句拆分逐条执行,聚合结果集
        let rs = b
            .run_sql(
                "CREATE TABLE m (x INT);\nINSERT INTO m VALUES (1);\nINSERT INTO m VALUES (2);\nSELECT * FROM m;\nSELECT x + 1 AS nx FROM m WHERE x = 2;",
                10,
            )
            .await
            .unwrap();
        assert_eq!(rs.len(), 5);
        assert_eq!(rs[3].rows.len(), 2);
        assert_eq!(rs[4].columns, vec!["nx"]);
        assert_eq!(rs[4].rows[0][0].as_deref(), Some("3"));

        // 字符串里带分号不会被误拆
        let rs = b
            .run_sql("SELECT 'a;b' AS s", 10)
            .await
            .unwrap();
        assert_eq!(rs.len(), 1);
        assert_eq!(rs[0].rows[0][0].as_deref(), Some("a;b"));

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn sqlite_foreign_keys() {
        let path = tmp_db("fk");
        let info = sqlite_info(&path);
        let mut b = backend::connect(&info).await.unwrap();
        b.run_sql(
            "CREATE TABLE a (id INTEGER PRIMARY KEY);\
             CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id));",
            10,
        )
        .await
        .unwrap();
        let fks = b.list_foreign_keys(&info).await.unwrap();
        assert_eq!(fks.len(), 1);
        assert_eq!(fks[0].table, "b");
        assert_eq!(fks[0].column, "a_id");
        assert_eq!(fks[0].ref_table, "a");
        assert_eq!(fks[0].ref_column, "id");
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn sqlite_trigger_and_ddl() {
        let path = tmp_db("trg");
        let info = sqlite_info(&path);
        let mut b = backend::connect(&info).await.unwrap();
        b.run_sql(
            "CREATE TABLE t (id INTEGER PRIMARY KEY, n INT);\
             CREATE TRIGGER trg_t AFTER INSERT ON t BEGIN UPDATE t SET n = n + 1 WHERE id = NEW.id; END;",
            10,
        )
        .await
        .unwrap();
        // 对象列表包含触发器
        let objs = b.list_tables(&info).await.unwrap();
        let trg = objs.iter().find(|o| o.kind == "trigger").expect("应有触发器");
        assert_eq!(trg.name, "trg_t");
        // DDL 提取
        let ddl = schema::object_ddl(&mut b, &info, "trigger", "trg_t").await.unwrap();
        assert!(ddl.contains("CREATE TRIGGER"));
        assert!(ddl.contains("AFTER INSERT ON t"));
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn sqlite_readonly_guard() {
        let path = tmp_db("ro");
        let mut info = sqlite_info(&path);
        let mut b = backend::connect(&info).await.unwrap();
        b.run_sql("CREATE TABLE r (x INT); INSERT INTO r VALUES (1);", 10).await.unwrap();

        // 只读模式下仅放行查询语句
        info.read_only = true;
        assert!(model::is_readonly_sql("select 1"));
        assert!(model::is_readonly_sql("  WITH t AS (SELECT 1) SELECT * FROM t"));
        assert!(model::is_readonly_sql("EXPLAIN QUERY PLAN SELECT 1"));
        assert!(!model::is_readonly_sql("DELETE FROM r"));
        assert!(!model::is_readonly_sql("DROP TABLE r"));

        // 只读连接上建立后拒绝写入(模拟 run_sql 拦截层逻辑)
        let sql = "INSERT INTO r VALUES (2)";
        if !model::is_readonly_sql(sql) {
            // 对应 run_sql 命令里的拦截分支
        } else {
            panic!("白名单误放行 INSERT");
        }
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn sqlite_global_search() {
        let path = tmp_db("search");
        let info = sqlite_info(&path);
        let mut b = backend::connect(&info).await.unwrap();
        b.run_sql(
            "CREATE TABLE s1 (id INTEGER PRIMARY KEY, name TEXT);             CREATE TABLE s2 (id INTEGER PRIMARY KEY, note TEXT);             INSERT INTO s1 (name) VALUES ('alpha'), ('Beta'), ('gamma');             INSERT INTO s2 (note) VALUES ('ALPHA note'), ('other');",
            20,
        )
        .await
        .unwrap();
        // 大小写不敏感跨表搜索
        let hits = search::search_tables(&mut b, &info, "alpha", 50).await.unwrap();
        assert_eq!(hits.len(), 2, "s1.alpha 与 s2.ALPHA note 都应命中");
        let tables: Vec<&str> = hits.iter().map(|h| h.table.as_str()).collect();
        assert!(tables.contains(&"s1"));
        assert!(tables.contains(&"s2"));
        // 命中列正确
        let h2 = hits.iter().find(|h| h.table == "s2").unwrap();
        assert_eq!(h2.column, "note");
        let _ = std::fs::remove_file(&path);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_saved_connections,
            save_connection,
            delete_connection,
            test_connection,
            connect,
            disconnect,
            list_tables,
            get_table_structure,
            count_rows,
            list_foreign_keys,
            export_table_sql,
            get_object_ddl,
            search_all_tables,
            redis_databases,
            redis_scan,
            redis_key_types,
            redis_set_ttl,
            redis_rename,
            redis_ttl_batch,
            redis_new_key,
            redis_member_op,
            redis_analyze,
            redis_key_detail,
            redis_del,
            redis_set,
            redis_run,
            apply_changes,
            write_text_file,
            read_text_file,
            read_binary_file,
            write_binary_file,
            read_binary_file,
            write_binary_file,
            run_sql
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
