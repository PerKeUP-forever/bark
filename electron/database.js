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

    CREATE TABLE IF NOT EXISTS quota_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      spec TEXT DEFAULT '',
      unit TEXT DEFAULT '',
      unit_price REAL DEFAULT 0,
      work_hours REAL DEFAULT 0,
      remark TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_quota_category ON quota_library(category);
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

// ========== 定额库操作 ==========

function getQuotaItems(category) {
  if (category) {
    return db.prepare('SELECT * FROM quota_library WHERE category = ? ORDER BY name ASC').all(category)
  }
  return db.prepare('SELECT * FROM quota_library ORDER BY category ASC, name ASC').all()
}

function createQuotaItem({ category, name, spec, unit, unit_price, work_hours, remark }) {
  const result = db.prepare(`
    INSERT INTO quota_library (category, name, spec, unit, unit_price, work_hours, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(category || '', name || '', spec || '', unit || '', unit_price ?? 0, work_hours ?? 0, remark || '')
  return db.prepare('SELECT * FROM quota_library WHERE id = ?').get(result.lastInsertRowid)
}

function updateQuotaItem(id, fields) {
  const allowedFields = ['category', 'name', 'spec', 'unit', 'unit_price', 'work_hours', 'remark']
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
  db.prepare(`UPDATE quota_library SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  return db.prepare('SELECT * FROM quota_library WHERE id = ?').get(id)
}

function deleteQuotaItem(id) {
  db.prepare('DELETE FROM quota_library WHERE id = ?').run(id)
  return { success: true }
}

function bulkCreateQuotaItems(items, clearExisting = false) {
  const transaction = db.transaction((items) => {
    if (clearExisting) {
      db.prepare('DELETE FROM quota_library').run()
    }

    const insertStmt = db.prepare(`
      INSERT INTO quota_library (category, name, spec, unit, unit_price, work_hours, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    // 去重：按 category + name + spec 判断是否已存在
    const checkStmt = db.prepare(
      'SELECT id FROM quota_library WHERE category = ? AND name = ? AND spec = ?'
    )

    let inserted = 0
    let skipped = 0
    for (const item of items) {
      const category = item.category || ''
      const name = item.name || ''
      const spec = item.spec || ''

      // 覆盖模式下已清空，无需检查
      if (!clearExisting) {
        const existing = checkStmt.get(category, name, spec)
        if (existing) {
          skipped++
          continue
        }
      }

      insertStmt.run(
        category, name, spec,
        item.unit || '',
        item.unit_price ?? 0,
        item.work_hours ?? 0,
        item.remark || ''
      )
      inserted++
    }
    return { inserted, skipped }
  })

  return transaction(items)
}

// ========== 预设定额库 ==========

function seedPresetQuotaItems() {
  // 检查是否已有数据，有则不重复播种
  const count = db.prepare('SELECT COUNT(*) as c FROM quota_library').get().c
  if (count > 0) return { seeded: false, count }

  const presets = [
    // ===== 人工费 =====
    { category: 'labor', name: '管道安装工', spec: '普通', unit: '工日', unit_price: 350, work_hours: 1, remark: '' },
    { category: 'labor', name: '管道安装工', spec: '高级', unit: '工日', unit_price: 500, work_hours: 1, remark: '' },
    { category: 'labor', name: '电焊工', spec: '普通', unit: '工日', unit_price: 400, work_hours: 1, remark: '' },
    { category: 'labor', name: '电焊工', spec: '高级/持证', unit: '工日', unit_price: 600, work_hours: 1, remark: '特种作业' },
    { category: 'labor', name: '电工', spec: '普通', unit: '工日', unit_price: 350, work_hours: 1, remark: '' },
    { category: 'labor', name: '电工', spec: '高级/持证', unit: '工日', unit_price: 500, work_hours: 1, remark: '' },
    { category: 'labor', name: '普通技工', spec: '', unit: '工日', unit_price: 300, work_hours: 1, remark: '' },
    { category: 'labor', name: '普通力工', spec: '', unit: '工日', unit_price: 200, work_hours: 1, remark: '' },
    { category: 'labor', name: '起重工', spec: '', unit: '工日', unit_price: 400, work_hours: 1, remark: '' },
    { category: 'labor', name: '测量放线工', spec: '', unit: '工日', unit_price: 350, work_hours: 1, remark: '' },

    // ===== 材料费 - 管道类 =====
    { category: 'material', name: '镀锌钢管', spec: 'DN15', unit: 'm', unit_price: 12, work_hours: 0, remark: '' },
    { category: 'material', name: '镀锌钢管', spec: 'DN20', unit: 'm', unit_price: 16, work_hours: 0, remark: '' },
    { category: 'material', name: '镀锌钢管', spec: 'DN25', unit: 'm', unit_price: 22, work_hours: 0, remark: '' },
    { category: 'material', name: '镀锌钢管', spec: 'DN32', unit: 'm', unit_price: 28, work_hours: 0, remark: '' },
    { category: 'material', name: '镀锌钢管', spec: 'DN40', unit: 'm', unit_price: 32, work_hours: 0, remark: '' },
    { category: 'material', name: '镀锌钢管', spec: 'DN50', unit: 'm', unit_price: 42, work_hours: 0, remark: '' },
    { category: 'material', name: '镀锌钢管', spec: 'DN65', unit: 'm', unit_price: 55, work_hours: 0, remark: '' },
    { category: 'material', name: '镀锌钢管', spec: 'DN80', unit: 'm', unit_price: 68, work_hours: 0, remark: '' },
    { category: 'material', name: '镀锌钢管', spec: 'DN100', unit: 'm', unit_price: 95, work_hours: 0, remark: '' },
    { category: 'material', name: '镀锌钢管', spec: 'DN150', unit: 'm', unit_price: 145, work_hours: 0, remark: '' },
    { category: 'material', name: '无缝钢管', spec: 'DN25', unit: 'm', unit_price: 30, work_hours: 0, remark: '' },
    { category: 'material', name: '无缝钢管', spec: 'DN32', unit: 'm', unit_price: 38, work_hours: 0, remark: '' },
    { category: 'material', name: '无缝钢管', spec: 'DN50', unit: 'm', unit_price: 55, work_hours: 0, remark: '' },
    { category: 'material', name: '无缝钢管', spec: 'DN80', unit: 'm', unit_price: 85, work_hours: 0, remark: '' },
    { category: 'material', name: '无缝钢管', spec: 'DN100', unit: 'm', unit_price: 120, work_hours: 0, remark: '' },
    { category: 'material', name: 'PPR管', spec: 'DN20', unit: 'm', unit_price: 6, work_hours: 0, remark: '热水管' },
    { category: 'material', name: 'PPR管', spec: 'DN25', unit: 'm', unit_price: 8, work_hours: 0, remark: '热水管' },
    { category: 'material', name: 'PPR管', spec: 'DN32', unit: 'm', unit_price: 12, work_hours: 0, remark: '' },
    { category: 'material', name: 'PPR管', spec: 'DN50', unit: 'm', unit_price: 22, work_hours: 0, remark: '' },
    { category: 'material', name: 'PVC排水管', spec: 'DN50', unit: 'm', unit_price: 8, work_hours: 0, remark: '' },
    { category: 'material', name: 'PVC排水管', spec: 'DN75', unit: 'm', unit_price: 12, work_hours: 0, remark: '' },
    { category: 'material', name: 'PVC排水管', spec: 'DN110', unit: 'm', unit_price: 18, work_hours: 0, remark: '' },
    { category: 'material', name: 'PVC排水管', spec: 'DN160', unit: 'm', unit_price: 30, work_hours: 0, remark: '' },

    // ===== 材料费 - 阀门管件 =====
    { category: 'material', name: '闸阀', spec: 'DN25', unit: '个', unit_price: 35, work_hours: 0, remark: '' },
    { category: 'material', name: '闸阀', spec: 'DN50', unit: '个', unit_price: 80, work_hours: 0, remark: '' },
    { category: 'material', name: '闸阀', spec: 'DN80', unit: '个', unit_price: 160, work_hours: 0, remark: '' },
    { category: 'material', name: '闸阀', spec: 'DN100', unit: '个', unit_price: 250, work_hours: 0, remark: '' },
    { category: 'material', name: '球阀', spec: 'DN15', unit: '个', unit_price: 15, work_hours: 0, remark: '' },
    { category: 'material', name: '球阀', spec: 'DN20', unit: '个', unit_price: 20, work_hours: 0, remark: '' },
    { category: 'material', name: '球阀', spec: 'DN25', unit: '个', unit_price: 28, work_hours: 0, remark: '' },
    { category: 'material', name: '球阀', spec: 'DN50', unit: '个', unit_price: 65, work_hours: 0, remark: '' },
    { category: 'material', name: '止回阀', spec: 'DN25', unit: '个', unit_price: 40, work_hours: 0, remark: '' },
    { category: 'material', name: '止回阀', spec: 'DN50', unit: '个', unit_price: 95, work_hours: 0, remark: '' },
    { category: 'material', name: '蝶阀', spec: 'DN100', unit: '个', unit_price: 280, work_hours: 0, remark: '' },
    { category: 'material', name: '蝶阀', spec: 'DN150', unit: '个', unit_price: 450, work_hours: 0, remark: '' },
    { category: 'material', name: '法兰', spec: 'DN50', unit: '片', unit_price: 25, work_hours: 0, remark: '' },
    { category: 'material', name: '法兰', spec: 'DN80', unit: '片', unit_price: 35, work_hours: 0, remark: '' },
    { category: 'material', name: '法兰', spec: 'DN100', unit: '片', unit_price: 45, work_hours: 0, remark: '' },
    { category: 'material', name: '弯头', spec: 'DN25', unit: '个', unit_price: 5, work_hours: 0, remark: '90°' },
    { category: 'material', name: '弯头', spec: 'DN50', unit: '个', unit_price: 12, work_hours: 0, remark: '90°' },
    { category: 'material', name: '弯头', spec: 'DN80', unit: '个', unit_price: 22, work_hours: 0, remark: '90°' },
    { category: 'material', name: '三通', spec: 'DN25', unit: '个', unit_price: 8, work_hours: 0, remark: '' },
    { category: 'material', name: '三通', spec: 'DN50', unit: '个', unit_price: 18, work_hours: 0, remark: '' },

    // ===== 材料费 - 电气类 =====
    { category: 'material', name: 'BV电线', spec: '2.5mm²', unit: 'm', unit_price: 2.5, work_hours: 0, remark: '' },
    { category: 'material', name: 'BV电线', spec: '4mm²', unit: 'm', unit_price: 3.8, work_hours: 0, remark: '' },
    { category: 'material', name: 'BV电线', spec: '6mm²', unit: 'm', unit_price: 5.5, work_hours: 0, remark: '' },
    { category: 'material', name: 'YJV电缆', spec: '3×2.5mm²', unit: 'm', unit_price: 12, work_hours: 0, remark: '' },
    { category: 'material', name: 'YJV电缆', spec: '3×4mm²', unit: 'm', unit_price: 16, work_hours: 0, remark: '' },
    { category: 'material', name: 'YJV电缆', spec: '3×6mm²', unit: 'm', unit_price: 22, work_hours: 0, remark: '' },
    { category: 'material', name: 'YJV电缆', spec: '4×10mm²', unit: 'm', unit_price: 38, work_hours: 0, remark: '' },
    { category: 'material', name: 'YJV电缆', spec: '4×16mm²', unit: 'm', unit_price: 55, work_hours: 0, remark: '' },
    { category: 'material', name: 'YJV电缆', spec: '4×25mm²', unit: 'm', unit_price: 80, work_hours: 0, remark: '' },
    { category: 'material', name: 'KBG管', spec: 'φ20', unit: 'm', unit_price: 4, work_hours: 0, remark: '穿线管' },
    { category: 'material', name: 'KBG管', spec: 'φ25', unit: 'm', unit_price: 5.5, work_hours: 0, remark: '穿线管' },
    { category: 'material', name: 'KBG管', spec: 'φ32', unit: 'm', unit_price: 7.5, work_hours: 0, remark: '穿线管' },
    { category: 'material', name: '桥架', spec: '200×100', unit: 'm', unit_price: 45, work_hours: 0, remark: '镀锌' },
    { category: 'material', name: '桥架', spec: '300×100', unit: 'm', unit_price: 60, work_hours: 0, remark: '镀锌' },
    { category: 'material', name: '桥架', spec: '400×150', unit: 'm', unit_price: 85, work_hours: 0, remark: '镀锌' },
    { category: 'material', name: '配电箱', spec: '明装 12位', unit: '个', unit_price: 120, work_hours: 0, remark: '' },
    { category: 'material', name: '配电箱', spec: '明装 24位', unit: '个', unit_price: 200, work_hours: 0, remark: '' },
    { category: 'material', name: '开关插座', spec: '单开', unit: '个', unit_price: 12, work_hours: 0, remark: '' },
    { category: 'material', name: '开关插座', spec: '五孔', unit: '个', unit_price: 15, work_hours: 0, remark: '' },

    // ===== 材料费 - 保温防腐 =====
    { category: 'material', name: '橡塑保温', spec: '厚20mm', unit: 'm²', unit_price: 35, work_hours: 0, remark: '' },
    { category: 'material', name: '橡塑保温', spec: '厚30mm', unit: 'm²', unit_price: 48, work_hours: 0, remark: '' },
    { category: 'material', name: '岩棉管壳', spec: '厚30mm', unit: 'm', unit_price: 20, work_hours: 0, remark: '' },
    { category: 'material', name: '岩棉管壳', spec: '厚50mm', unit: 'm', unit_price: 32, work_hours: 0, remark: '' },
    { category: 'material', name: '防锈漆', spec: '', unit: 'kg', unit_price: 25, work_hours: 0, remark: '' },
    { category: 'material', name: '面漆', spec: '', unit: 'kg', unit_price: 35, work_hours: 0, remark: '' },

    // ===== 设备费 =====
    { category: 'equipment', name: '离心水泵', spec: 'Q=10m³/h H=20m', unit: '台', unit_price: 3500, work_hours: 0, remark: '' },
    { category: 'equipment', name: '离心水泵', spec: 'Q=20m³/h H=25m', unit: '台', unit_price: 5500, work_hours: 0, remark: '' },
    { category: 'equipment', name: '离心水泵', spec: 'Q=50m³/h H=32m', unit: '台', unit_price: 12000, work_hours: 0, remark: '' },
    { category: 'equipment', name: '排污泵', spec: 'Q=15m³/h', unit: '台', unit_price: 2800, work_hours: 0, remark: '' },
    { category: 'equipment', name: '风机盘管', spec: 'FP-34', unit: '台', unit_price: 850, work_hours: 0, remark: '' },
    { category: 'equipment', name: '风机盘管', spec: 'FP-51', unit: '台', unit_price: 1100, work_hours: 0, remark: '' },
    { category: 'equipment', name: '风机盘管', spec: 'FP-68', unit: '台', unit_price: 1400, work_hours: 0, remark: '' },
    { category: 'equipment', name: '新风机组', spec: '2000m³/h', unit: '台', unit_price: 8000, work_hours: 0, remark: '' },
    { category: 'equipment', name: '新风机组', spec: '5000m³/h', unit: '台', unit_price: 15000, work_hours: 0, remark: '' },
    { category: 'equipment', name: '空调主机', spec: '风冷模块 65kW', unit: '台', unit_price: 35000, work_hours: 0, remark: '' },
    { category: 'equipment', name: '稳压罐', spec: 'SQL600×0.6', unit: '台', unit_price: 2200, work_hours: 0, remark: '' },
    { category: 'equipment', name: '水箱', spec: '不锈钢 5m³', unit: '个', unit_price: 6000, work_hours: 0, remark: '' },
    { category: 'equipment', name: '水箱', spec: '不锈钢 10m³', unit: '个', unit_price: 10000, work_hours: 0, remark: '' },

    // ===== 机械租赁费 =====
    { category: 'rental', name: '汽车吊', spec: '25t', unit: '台班', unit_price: 3500, work_hours: 0, remark: '' },
    { category: 'rental', name: '汽车吊', spec: '50t', unit: '台班', unit_price: 6000, work_hours: 0, remark: '' },
    { category: 'rental', name: '叉车', spec: '3t', unit: '台班', unit_price: 800, work_hours: 0, remark: '' },
    { category: 'rental', name: '电焊机', spec: '交流 400A', unit: '台班', unit_price: 120, work_hours: 0, remark: '' },
    { category: 'rental', name: '电焊机', spec: '直流 500A', unit: '台班', unit_price: 180, work_hours: 0, remark: '' },
    { category: 'rental', name: '套丝机', spec: 'DN15-100', unit: '台班', unit_price: 100, work_hours: 0, remark: '' },
    { category: 'rental', name: '液压弯管机', spec: '', unit: '台班', unit_price: 150, work_hours: 0, remark: '' },
    { category: 'rental', name: '管道试压泵', spec: '', unit: '台班', unit_price: 80, work_hours: 0, remark: '' },
    { category: 'rental', name: '脚手架', spec: '钢管', unit: 'm²·月', unit_price: 15, work_hours: 0, remark: '' },
    { category: 'rental', name: '发电机', spec: '30kW', unit: '台班', unit_price: 350, work_hours: 0, remark: '' },
    { category: 'rental', name: '空压机', spec: '0.6m³/min', unit: '台班', unit_price: 200, work_hours: 0, remark: '' },
    { category: 'rental', name: '高空作业车', spec: '16m', unit: '台班', unit_price: 1500, work_hours: 0, remark: '' },
  ]

  const stmt = db.prepare(`
    INSERT INTO quota_library (category, name, spec, unit, unit_price, work_hours, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const transaction = db.transaction(() => {
    for (const item of presets) {
      stmt.run(item.category, item.name, item.spec, item.unit, item.unit_price, item.work_hours, item.remark)
    }
  })
  transaction()

  return { seeded: true, count: presets.length }
}

// ========== 导出数据 ==========

function getExportData(projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)
  const items = db.prepare('SELECT * FROM budget_items WHERE project_id = ? ORDER BY sort_order ASC').all(projectId)
  const summary = getSummary(projectId)
  return { project, items, summary }
}

// ========== 批量导入 ==========

function bulkCreateItems(projectId, itemsData) {
  const transaction = db.transaction((items) => {
    // 清除项目已有数据
    db.prepare('DELETE FROM budget_items WHERE project_id = ?').run(projectId)

    const idMap = {} // oldTempId -> newRealId

    for (const item of items) {
      const parentId = item._tempParentId ? (idMap[item._tempParentId] || null) : null
      const result = db.prepare(`
        INSERT INTO budget_items (project_id, parent_id, name, level, sort_order, category, spec, unit, quantity, unit_price, work_hours, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        projectId, parentId,
        item.name || '新项目', item.level ?? 0, item.sort_order ?? 0,
        item.category || '', item.spec || '', item.unit || '',
        item.quantity ?? 0, item.unit_price ?? 0, item.work_hours ?? 0, item.remark || ''
      )
      if (item._tempId) {
        idMap[item._tempId] = result.lastInsertRowid
      }
    }

    db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(projectId)
  })

  transaction(itemsData)
  return getItems(projectId)
}

// ========== 数据分析 ==========

function getAnalytics(projectId) {
  // 按分部工程统计
  const byDivision = db.prepare(`
    SELECT
      p.id, p.name,
      COUNT(d.id) as item_count,
      SUM(d.quantity * d.unit_price) as total_cost,
      SUM(d.work_hours) as total_hours
    FROM budget_items p
    LEFT JOIN budget_items s ON s.parent_id = p.id AND s.level = 1
    LEFT JOIN budget_items d ON d.parent_id = s.id AND d.level = 2
    WHERE p.project_id = ? AND p.level = 0
    GROUP BY p.id, p.name
    ORDER BY p.sort_order ASC
  `).all(projectId)

  // 各费用类别明细
  const categoryDetails = db.prepare(`
    SELECT category, name, spec, unit, quantity, unit_price,
           (quantity * unit_price) as amount, work_hours
    FROM budget_items
    WHERE project_id = ? AND level = 2 AND category != ''
    ORDER BY category, name
  `).all(projectId)

  // 单价 Top 10
  const topExpensive = db.prepare(`
    SELECT name, spec, unit, quantity, unit_price,
           (quantity * unit_price) as amount, category
    FROM budget_items
    WHERE project_id = ? AND level = 2
    ORDER BY amount DESC
    LIMIT 10
  `).all(projectId)

  return { byDivision, categoryDetails, topExpensive }
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
  getQuotaItems,
  createQuotaItem,
  updateQuotaItem,
  deleteQuotaItem,
  getExportData,
  bulkCreateItems,
  bulkCreateQuotaItems,
  seedPresetQuotaItems,
  getAnalytics,
}
