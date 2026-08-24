/**
 * 新建对象(触发器/存储过程/函数/视图)的 SQL 模板
 * 按方言生成可编辑的初始 SQL
 */
import type { DbType } from '../types'

export type ObjKind = 'trigger' | 'procedure' | 'function' | 'view'

export interface TemplateDef {
  kind: ObjKind
  label: string
  templates: Partial<Record<DbType, string>>
  /** SQLite 是否支持 */
  sqliteSupported: boolean
}

export const TEMPLATES: TemplateDef[] = [
  {
    kind: 'trigger',
    label: '触发器',
    sqliteSupported: true,
    templates: {
      sqlite: `CREATE TRIGGER [trigger_name]
AFTER INSERT ON [table_name]
BEGIN
  -- 触发器逻辑
  UPDATE [table_name] SET updated_at = datetime('now') WHERE id = NEW.id;
END;`,
      mysql: `CREATE TRIGGER \`trigger_name\`
AFTER INSERT ON \`table_name\`
FOR EACH ROW
BEGIN
  -- 触发器逻辑
  UPDATE \`table_name\` SET updated_at = NOW() WHERE id = NEW.id;
END;`,
      postgres: `CREATE OR REPLACE FUNCTION trigger_function()
RETURNS TRIGGER AS $$
BEGIN
  -- 触发器逻辑
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_name
AFTER INSERT ON table_name
FOR EACH ROW EXECUTE FUNCTION trigger_function();`,
    },
  },
  {
    kind: 'procedure',
    label: '存储过程',
    sqliteSupported: false,
    templates: {
      mysql: `CREATE PROCEDURE \`procedure_name\`(IN param1 INT)
BEGIN
  -- 存储过程逻辑
  SELECT * FROM \`table_name\` WHERE id = param1;
END;`,
      postgres: `CREATE OR REPLACE PROCEDURE procedure_name(param1 INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
  -- 存储过程逻辑
  PERFORM * FROM table_name WHERE id = param1;
END;
$$;`,
    },
  },
  {
    kind: 'function',
    label: '函数',
    sqliteSupported: false,
    templates: {
      mysql: `CREATE FUNCTION \`function_name\`(param1 INT)
RETURNS VARCHAR(255)
DETERMINISTIC
BEGIN
  DECLARE result VARCHAR(255);
  SELECT name INTO result FROM \`table_name\` WHERE id = param1;
  RETURN result;
END;`,
      postgres: `CREATE OR REPLACE FUNCTION function_name(param1 INTEGER)
RETURNS TEXT AS $$
DECLARE
  result TEXT;
BEGIN
  SELECT name INTO result FROM table_name WHERE id = param1;
  RETURN result;
END;
$$ LANGUAGE plpgsql;`,
      sqlite: `-- SQLite 3.9+ 支持用户自定义函数(需注册)
-- 建议在应用层注册,或使用 SQL 内置函数`,
    },
  },
  {
    kind: 'view',
    label: '视图',
    sqliteSupported: true,
    templates: {
      sqlite: `CREATE VIEW [view_name] AS
SELECT
  column1,
  column2
FROM [table_name]
WHERE condition;`,
      mysql: `CREATE VIEW \`view_name\` AS
SELECT
  column1,
  column2
FROM \`table_name\`
WHERE condition;`,
      postgres: `CREATE OR REPLACE VIEW view_name AS
SELECT
  column1,
  column2
FROM table_name
WHERE condition;`,
    },
  },
]

export function getTemplate(kind: ObjKind, dbType: DbType): string {
  const def = TEMPLATES.find((t) => t.kind === kind)
  if (!def) return ''
  return def.templates[dbType] ?? def.templates.mysql ?? Object.values(def.templates)[0] ?? ''
}
