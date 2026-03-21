const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const db = require('./database')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: '预算编制系统',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 开发环境加载 Vite dev server，生产环境加载打包文件
  if (process.env.NODE_ENV !== 'production' && !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  db.initialize()
  try {
    const seedResult = db.seedPresetQuotaItems()
    console.log('[定额库播种]', seedResult)
  } catch (err) {
    console.error('[定额库播种失败]', err)
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ========== 项目 IPC ==========
ipcMain.handle('project:list', () => db.getProjects())
ipcMain.handle('project:create', (_, name, description) => db.createProject(name, description))
ipcMain.handle('project:delete', (_, id) => db.deleteProject(id))
ipcMain.handle('project:rename', (_, id, name) => db.renameProject(id, name))

// ========== 预算项 IPC ==========
ipcMain.handle('item:list', (_, projectId) => db.getItems(projectId))
ipcMain.handle('item:create', (_, item) => db.createItem(item))
ipcMain.handle('item:update', (_, id, fields) => db.updateItem(id, fields))
ipcMain.handle('item:delete', (_, id) => db.deleteItem(id))
ipcMain.handle('item:reorder', (_, items) => db.reorderItems(items))

// ========== 汇总 IPC ==========
ipcMain.handle('summary:get', (_, projectId) => db.getSummary(projectId))

// ========== 定额库 IPC ==========
ipcMain.handle('quota:list', (_, category) => db.getQuotaItems(category))
ipcMain.handle('quota:create', (_, item) => db.createQuotaItem(item))
ipcMain.handle('quota:update', (_, id, fields) => db.updateQuotaItem(id, fields))
ipcMain.handle('quota:delete', (_, id) => db.deleteQuotaItem(id))

// ========== 导出 IPC ==========
ipcMain.handle('export:excel', async (_, projectId) => {
  const data = db.getExportData(projectId)
  if (!data.project) return { success: false, error: '项目不存在' }

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出预算表',
    defaultPath: `${data.project.name}_预算表.xlsx`,
    filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
  })
  if (canceled || !filePath) return { success: false, canceled: true }

  try {
    const ExcelJS = require('exceljs')
    const workbook = new ExcelJS.Workbook()
    workbook.creator = '预算编制系统'
    workbook.created = new Date()

    // --- Sheet 1: 预算明细 ---
    const ws = workbook.addWorksheet('预算明细')

    // 标题行
    ws.mergeCells('A1:K1')
    const titleCell = ws.getCell('A1')
    titleCell.value = `${data.project.name} - 预算明细表`
    titleCell.font = { size: 16, bold: true }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(1).height = 30

    // 表头
    const headers = ['序号', '层级', '名称', '费用类别', '规格型号', '单位', '数量', '单价', '金额', '工时', '备注']
    const headerRow = ws.addRow(headers)
    headerRow.font = { bold: true, size: 11 }
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' }
    headerRow.height = 22
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
    })

    // 列宽
    ws.columns = [
      { width: 8 }, { width: 10 }, { width: 30 }, { width: 12 },
      { width: 15 }, { width: 8 }, { width: 10 }, { width: 12 },
      { width: 14 }, { width: 8 }, { width: 15 },
    ]

    const levelLabels = { 0: '分部工程', 1: '分项工程', 2: '明细' }
    const categoryLabels = { labor: '人工费', material: '材料费', equipment: '设备费', rental: '机械租赁费' }

    // 构建树并递归输出
    const buildTree = (items) => {
      const map = {}
      const roots = []
      items.forEach((item) => { map[item.id] = { ...item, children: [] } })
      items.forEach((item) => {
        if (item.parent_id && map[item.parent_id]) {
          map[item.parent_id].children.push(map[item.id])
        } else {
          roots.push(map[item.id])
        }
      })
      const sortChildren = (nodes) => {
        nodes.sort((a, b) => a.sort_order - b.sort_order)
        nodes.forEach((n) => sortChildren(n.children))
      }
      sortChildren(roots)
      return roots
    }

    const calcSubtotal = (node) => {
      if (node.level === 2) return (node.quantity || 0) * (node.unit_price || 0)
      return (node.children || []).reduce((sum, child) => sum + calcSubtotal(child), 0)
    }

    let rowIndex = 1
    const writeNode = (node, depth) => {
      const amount = node.level === 2
        ? (node.quantity || 0) * (node.unit_price || 0)
        : calcSubtotal(node)

      const row = ws.addRow([
        rowIndex++,
        levelLabels[node.level] || '',
        '  '.repeat(depth) + node.name,
        categoryLabels[node.category] || '',
        node.level === 2 ? (node.spec || '') : '',
        node.level === 2 ? (node.unit || '') : '',
        node.level === 2 ? (node.quantity || '') : '',
        node.level === 2 ? (node.unit_price || '') : '',
        amount > 0 ? amount : '',
        node.level === 2 ? (node.work_hours || '') : '',
        node.remark || '',
      ])

      row.eachCell((cell) => {
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
      })

      if (node.level === 0) {
        row.font = { bold: true, size: 11 }
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } }
        })
      } else if (node.level === 1) {
        row.font = { bold: true }
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } }
        })
      }

      // 金额列格式
      const amountCell = row.getCell(9)
      if (typeof amountCell.value === 'number') {
        amountCell.numFmt = '#,##0.00'
      }

      ;(node.children || []).forEach((child) => writeNode(child, depth + 1))
    }

    const tree = buildTree(data.items)
    tree.forEach((node) => writeNode(node, 0))

    // 汇总行
    const totalRow = ws.addRow(['', '', '合计', '', '', '', '', '', data.summary.total.total_cost || 0, data.summary.total.total_hours || 0, ''])
    totalRow.font = { bold: true, size: 12 }
    totalRow.getCell(9).numFmt = '#,##0.00'
    totalRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
      cell.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } }
    })

    // --- Sheet 2: 费用汇总 ---
    const ws2 = workbook.addWorksheet('费用汇总')
    ws2.columns = [{ width: 15 }, { width: 15 }, { width: 12 }, { width: 12 }]
    ws2.addRow(['费用类别', '金额', '占比', '工时']).font = { bold: true }
    const totalCost = data.summary.total.total_cost || 0
    for (const cat of data.summary.byCategory) {
      ws2.addRow([
        categoryLabels[cat.category] || cat.category,
        cat.total_cost || 0,
        totalCost > 0 ? ((cat.total_cost / totalCost) * 100).toFixed(1) + '%' : '0%',
        cat.total_hours || 0,
      ])
    }
    ws2.addRow(['合计', totalCost, '100%', data.summary.total.total_hours || 0]).font = { bold: true }

    await workbook.xlsx.writeFile(filePath)
    return { success: true, filePath }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('export:pdf', async (_, projectId) => {
  const data = db.getExportData(projectId)
  if (!data.project) return { success: false, error: '项目不存在' }

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出 PDF',
    defaultPath: `${data.project.name}_预算表.pdf`,
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return { success: false, canceled: true }

  try {
    const pdfData = await mainWindow.webContents.printToPDF({
      marginsType: 0,
      printBackground: true,
      landscape: true,
    })
    fs.writeFileSync(filePath, pdfData)
    return { success: true, filePath }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ========== 导入 IPC ==========
ipcMain.handle('import:excel', async (_, projectId) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '导入 Excel 预算表',
    filters: [{ name: 'Excel 文件', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  })
  if (canceled || !filePaths.length) return { success: false, canceled: true }

  try {
    const ExcelJS = require('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(filePaths[0])
    const ws = workbook.worksheets[0]
    if (!ws) return { success: false, error: '文件中没有工作表' }

    const rows = []
    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= 1) return // 跳过标题
      const values = []
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        values[colNumber - 1] = cell.value
      })
      rows.push(values)
    })

    // 尝试解析：检测是否是本系统导出的格式
    // 导出格式: [序号, 层级, 名称, 费用类别, 规格型号, 单位, 数量, 单价, 金额, 工时, 备注]
    const levelMap = { '分部工程': 0, '分项工程': 1, '明细': 2 }
    const categoryMap = { '人工费': 'labor', '材料费': 'material', '设备费': 'equipment', '机械租赁费': 'rental' }

    const parsedItems = []
    let tempIdCounter = 1
    const parentStack = [{ tempId: null, level: -1 }] // 用于追踪父级

    for (const row of rows) {
      const levelStr = String(row[1] || '').trim()
      const level = levelMap[levelStr]
      if (level === undefined) continue // 跳过非数据行（如合计行）

      const name = String(row[2] || '').trim().replace(/^\s+/, '')
      if (!name) continue

      const tempId = `temp_${tempIdCounter++}`
      const catStr = String(row[3] || '').trim()

      // 找到正确的父级
      while (parentStack.length > 1 && parentStack[parentStack.length - 1].level >= level) {
        parentStack.pop()
      }
      const parentTempId = parentStack[parentStack.length - 1].tempId

      parsedItems.push({
        _tempId: tempId,
        _tempParentId: parentTempId,
        name,
        level,
        sort_order: parsedItems.filter((p) => p._tempParentId === parentTempId).length,
        category: categoryMap[catStr] || '',
        spec: level === 2 ? String(row[4] || '') : '',
        unit: level === 2 ? String(row[5] || '') : '',
        quantity: level === 2 ? (parseFloat(row[6]) || 0) : 0,
        unit_price: level === 2 ? (parseFloat(row[7]) || 0) : 0,
        work_hours: level === 2 ? (parseFloat(row[9]) || 0) : 0,
        remark: String(row[10] || ''),
      })

      parentStack.push({ tempId, level })
    }

    if (parsedItems.length === 0) {
      return { success: false, error: '未解析到有效数据，请检查文件格式' }
    }

    const items = db.bulkCreateItems(projectId, parsedItems)
    return { success: true, count: parsedItems.length, items }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ========== 定额库预设播种 IPC ==========
ipcMain.handle('quota:seed', () => db.seedPresetQuotaItems(true))

// ========== 定额库导入 IPC ==========

const CATEGORY_MAP = { '人工费': 'labor', '材料费': 'material', '设备费': 'equipment', '机械租赁费': 'rental' }

function matchColumns(headerValues) {
  const colMap = {}
  headerValues.forEach((val, index) => {
    const s = String(val || '').trim()
    if (/名称|项目名/.test(s)) colMap.name = index
    else if (/类别|费用/.test(s)) colMap.category = index
    else if (/规格|型号/.test(s)) colMap.spec = index
    else if (/单位/.test(s) && !colMap.unit) colMap.unit = index
    else if (/单价|价格/.test(s)) colMap.unit_price = index
    else if (/工时|工日/.test(s)) colMap.work_hours = index
    else if (/备注|说明/.test(s)) colMap.remark = index
  })
  return colMap
}

function parseRowToItem(values, colMap) {
  const get = (field, fallback) => String(values[colMap[field] ?? fallback] || '').trim()
  const name = get('name', 1)
  if (!name) return null

  const catStr = get('category', 0)
  return {
    category: CATEGORY_MAP[catStr] || catStr || '',
    name,
    spec: get('spec', 2),
    unit: get('unit', 3),
    unit_price: parseFloat(values[colMap.unit_price ?? 4]) || 0,
    work_hours: parseFloat(values[colMap.work_hours ?? 5]) || 0,
    remark: get('remark', 6),
  }
}

function parseCsvContent(content) {
  const lines = content.split(/\r?\n/).filter(line => line.trim())
  if (lines.length < 2) return []

  // 简易 CSV 解析，支持引号内的逗号
  const parseLine = (line) => {
    const result = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const headerValues = parseLine(lines[0])
  const colMap = matchColumns(headerValues)
  // 如果没有匹配到名称列，使用默认列序
  if (colMap.name === undefined) {
    colMap.category = 0; colMap.name = 1; colMap.spec = 2; colMap.unit = 3
    colMap.unit_price = 4; colMap.work_hours = 5; colMap.remark = 6
  }

  const items = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i])
    const item = parseRowToItem(values, colMap)
    if (item) items.push(item)
  }
  return items
}

ipcMain.handle('quota:import', async (_, options) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '导入定额库',
    filters: [
      { name: 'Excel/CSV 文件', extensions: ['xlsx', 'xls', 'csv'] },
      { name: 'Excel 文件', extensions: ['xlsx', 'xls'] },
      { name: 'CSV 文件', extensions: ['csv'] },
    ],
    properties: ['openFile'],
  })
  if (canceled || !filePaths.length) return { success: false, canceled: true }

  try {
    const filePath = filePaths[0]
    const ext = path.extname(filePath).toLowerCase()
    let items = []

    if (ext === '.csv') {
      // CSV 解析
      const content = fs.readFileSync(filePath, 'utf-8')
      items = parseCsvContent(content)
    } else {
      // Excel 解析
      const ExcelJS = require('exceljs')
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(filePath)
      const ws = workbook.worksheets[0]
      if (!ws) return { success: false, error: '文件中没有工作表' }

      // 读取表头
      const headerRow = ws.getRow(1)
      const headerValues = []
      headerRow.eachCell((cell, colNumber) => { headerValues[colNumber - 1] = cell.value })
      const colMap = matchColumns(headerValues)
      if (colMap.name === undefined) {
        colMap.category = 0; colMap.name = 1; colMap.spec = 2; colMap.unit = 3
        colMap.unit_price = 4; colMap.work_hours = 5; colMap.remark = 6
      }

      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 1) return
        const values = []
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => { values[colNumber - 1] = cell.value })
        const item = parseRowToItem(values, colMap)
        if (item) items.push(item)
      })
    }

    if (items.length === 0) {
      return { success: false, error: '未解析到有效数据，请检查文件格式' }
    }

    const clearExisting = options?.clearExisting || false
    const result = db.bulkCreateQuotaItems(items, clearExisting)
    return { success: true, ...result, total: items.length }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ========== 数据分析 IPC ==========
ipcMain.handle('analytics:get', (_, projectId) => db.getAnalytics(projectId))

// ========== 文件选择 IPC ==========
ipcMain.handle('dialog:openFile', async (_, options) => {
  return dialog.showOpenDialog(mainWindow, options)
})

ipcMain.handle('dialog:saveFile', async (_, options) => {
  return dialog.showSaveDialog(mainWindow, options)
})
