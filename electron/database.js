const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')

let db

function getDbPath() {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'budget.db')
}

function initialize() {
  db = new Database(getDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS budget_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      parent_id INTEGER,
      name TEXT NOT NULL DEFAULT '新项目',
      level INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      category TEXT DEFAULT '',
      spec TEXT DEFAULT '',
      unit TEXT DEFAULT '',
      quantity REAL DEFAULT 0,
      unit_price REAL DEFAULT 0,
      work_hours REAL DEFAULT 0,
      remark TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES budget_items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_items_project ON budget_items(project_id);
    CREATE INDEX IF NOT EXISTS idx_items_parent ON budget_items(parent_id);
  `)
}

// ========== 项目操作 ==========

function getProjects() {
  return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all()
}

function createProject(name, description = '') {
  const result = db.prepare('INSERT INTO projects (name, description) VALUES (?, ?)').run(name, description)
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid)
}

function deleteProject(id) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return { success: true }
}

function renameProject(id, name) {
  db.prepare('UPDATE projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, id)
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
}

// ========== 预算项操作 ==========

function getItems(projectId) {
  return db.prepare(
    'SELECT * FROM budget_items WHERE project_id = ? ORDER BY sort_order ASC'
  ).all(projectId)
}

function createItem({ project_id, parent_id, name, level, sort_order, category, spec, unit, quantity, unit_price, work_hours, remark }) {
  // 如果没有指定 sort_order，取同级最大值 + 1
  if (sort_order === undefined || sort_order === null) {
    const max = db.prepare(
      'SELECT MAX(sort_order) as max_order FROM budget_items WHERE project_id = ? AND parent_id IS ?'
    ).get(project_id, parent_id || null)
    sort_order = (max?.max_order ?? -1) + 1
  }

  const result = db.prepare(`
    INSERT INTO budget_items (project_id, parent_id, name, level, sort_order, category, spec, unit, quantity, unit_price, work_hours, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    project_id,
    parent_id || null,
    name || '新项目',
    level ?? 0,
    sort_order,
    category || '',
    spec || '',
    unit || '',
    quantity ?? 0,
    unit_price ?? 0,
    work_hours ?? 0,
    remark || ''
  )

  // 更新项目时间戳
  db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(project_id)

  return db.prepare('SELECT * FROM budget_items WHERE id = ?').get(result.lastInsertRowid)
}

function updateItem(id, fields) {
  const allowedFields = ['name', 'category', 'spec', 'unit', 'quantity', 'unit_price', 'work_hours', 'remark', 'parent_id', 'sort_order']
  const updates = []
  const values = []

  for (const [key, value] of Object.entries(fields)) {
    if (allowedFields.includes(key)) {
      updates.push(`${key} = ?`)
      values.push(value)
    }
  }

  if (updates.length === 0) return null

  values.push(id)
  db.prepare(`UPDATE budget_items SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  // 更新项目时间戳
  const item = db.prepare('SELECT * FROM budget_items WHERE id = ?').get(id)
  if (item) {
    db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(item.project_id)
  }
  return item
}

function deleteItem(id) {
  // 级联删除子项（通过外键约束自动处理）
  db.prepare('DELETE FROM budget_items WHERE id = ?').run(id)
  return { success: true }
}

function reorderItems(items) {
  const stmt = db.prepare('UPDATE budget_items SET sort_order = ?, parent_id = ? WHERE id = ?')
  const transaction = db.transaction((items) => {
    for (const { id, sort_order, parent_id } of items) {
      stmt.run(sort_order, parent_id || null, id)
    }
  })
  transaction(items)
  return { success: true }
}

// ========== 汇总统计 ==========

function getSummary(projectId) {
  // 按费用类别汇总
  const byCategory = db.prepare(`
    SELECT
      category,
      COUNT(*) as count,
      SUM(quantity * unit_price) as total_cost,
      SUM(work_hours) as total_hours
    FROM budget_items
    WHERE project_id = ? AND level = 2 AND category != ''
    GROUP BY category
  `).all(projectId)

  // 总计
  const total = db.prepare(`
    SELECT
      COUNT(*) as count,
      SUM(quantity * unit_price) as total_cost,
      SUM(work_hours) as total_hours
    FROM budget_items
    WHERE project_id = ? AND level = 2
  `).get(projectId)

  return { byCategory, total }
}

module.exports = {
  initialize,
  getProjects,
  createProject,
  deleteProject,
  renameProject,
  getItems,
  createItem,
  updateItem,
  deleteItem,
  reorderItems,
  getSummary,
}
