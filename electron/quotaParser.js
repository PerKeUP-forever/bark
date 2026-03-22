/**
 * 定额 PDF 解析器
 *
 * 支持解析标准定额编制文件（如安装工程定额），从 PDF 中提取：
 * - 定额子目信息（编号、名称、综合单价）
 * - 资源明细（人工、材料、机械），每条包含 8 位编码、名称、规格、单位、单价、消耗量
 *
 * 编码规则：
 *   定额编号：X-Y-Z（册-节-子目）
 *   资源编码 8 位：前 2 位为大类
 *     00       = 人工
 *     01-37    = 材料（01 金属、02 非金属/化工、03 焊接、13 涂料、14 油料/气体 …）
 *     98-99    = 机械（98 专用仪器、99 通用机械）
 *     994xxxxx = 其他费用
 */

const { PDFParse } = require('pdf-parse')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

// ---- 资源编码前缀 → 类别映射 ----
function codeToCategory(code) {
  if (!code) return 'material'
  const prefix = code.substring(0, 2)
  const n = parseInt(prefix, 10)
  if (n === 0) return 'labor'         // 00 = 人工
  if (n >= 1 && n <= 37) return 'material'  // 01-37 = 材料
  if (n >= 98) return 'rental'        // 98-99 = 机械
  if (code.startsWith('994')) return 'material' // 994 = 其他费用
  return 'material'
}

// 资源编码 AA-BB-CCCC → 精细中文类别描述
// AA = 大类(前2位)  BB = 中类(第3-4位)  CCCC = 顺序号(后4位)
function codeToSubCategory(code) {
  if (!code || code.length < 4) return ''
  const major = parseInt(code.substring(0, 2), 10)  // AA 大类
  const minor = parseInt(code.substring(2, 4), 10)  // BB 中类

  // 00 = 人工
  if (major === 0) {
    if (minor === 1) return '人工-综合用工'
    if (minor === 2) return '人工-技术用工'
    if (minor === 3) return '人工-辅助用工'
    return '人工'
  }

  // 01 = 黑色金属材料
  if (major === 1) {
    if (minor <= 2) return '金属-型钢/钢板'
    if (minor === 3) return '金属-钢丝'
    if (minor >= 4 && minor <= 6) return '金属-钢管'
    if (minor >= 7 && minor <= 9) return '金属-钢板/带钢'
    if (minor >= 10 && minor <= 12) return '金属-铸钢件'
    if (minor >= 13 && minor <= 15) return '金属-铸铁件'
    if (minor >= 16 && minor <= 19) return '金属-五金配件'
    return '金属材料'
  }

  // 02 = 有色金属 / 非金属 / 化工材料
  if (major === 2) {
    if (minor <= 5) return '有色金属-铜材'
    if (minor >= 6 && minor <= 10) return '有色金属-铝材'
    if (minor >= 11 && minor <= 15) return '非金属-橡胶/塑料'
    if (minor >= 16 && minor <= 20) return '非金属-石棉/密封'
    if (minor >= 21 && minor <= 25) return '非金属-玻璃/陶瓷'
    if (minor >= 26 && minor <= 30) return '化工-化学制品'
    if (minor >= 31) return '化工-其他'
    return '非金属/化工材料'
  }

  // 03 = 焊接材料
  if (major === 3) {
    if (minor <= 5) return '焊接-焊条'
    if (minor >= 6 && minor <= 10) return '焊接-焊丝'
    if (minor >= 11 && minor <= 15) return '焊接-焊剂/焊粉'
    if (minor >= 16) return '焊接-辅料'
    return '焊接材料'
  }

  // 04-12 = 其他材料细分
  if (major >= 4 && major <= 6) return '木材/胶合板'
  if (major >= 7 && major <= 9) return '水泥/混凝土制品'
  if (major >= 10 && major <= 12) return '砖瓦/砂石'

  // 13 = 涂料
  if (major === 13) {
    if (minor <= 2) return '涂料-防腐漆/面漆'
    if (minor >= 3 && minor <= 5) return '涂料-防锈漆/底漆'
    if (minor >= 6 && minor <= 8) return '涂料-调和漆'
    if (minor >= 9) return '涂料-特种涂料'
    return '涂料'
  }

  // 14 = 油料 / 气体
  if (major === 14) {
    if (minor <= 2) return '油料-润滑脂'
    if (minor >= 3 && minor <= 5) return '油料-机油/润滑油'
    if (minor >= 6 && minor <= 8) return '油料-液压油'
    if (minor >= 9 && minor <= 15) return '油料-特种油料'
    if (minor >= 16 && minor <= 29) return '油料-其他'
    if (minor >= 30 && minor <= 35) return '气体-氧气/乙炔'
    if (minor >= 36 && minor <= 39) return '气体-保护气/混合气'
    if (minor >= 40) return '气体-其他气体'
    return '油料/气体'
  }

  // 15-26 = 中间材料类别
  if (major >= 15 && major <= 26) return '其他材料'

  // 27-37 = 辅助材料
  if (major >= 27 && major <= 37) {
    if (major === 27) return '辅材-紧固件'
    if (major === 28) return '辅材-密封件'
    if (major === 29) return '辅材-绝缘材料'
    if (major >= 30 && major <= 33) return '辅材-保温材料'
    if (major >= 34 && major <= 37) return '辅材-周转材料'
    return '辅助材料'
  }

  // 98 = 专用仪器仪表
  if (major === 98) {
    if (minor <= 10) return '仪器-测量仪器'
    if (minor >= 11 && minor <= 20) return '仪器-检测仪器'
    if (minor >= 21) return '仪器-其他仪器'
    return '专用仪器'
  }

  // 99 = 通用施工机械
  if (major === 99) {
    if (minor <= 5) return '机械-起重机械'
    if (minor >= 6 && minor <= 10) return '机械-运输机械'
    if (minor >= 11 && minor <= 15) return '机械-焊接机械'
    if (minor >= 16 && minor <= 20) return '机械-切割机械'
    if (minor >= 21 && minor <= 30) return '机械-通用动力'
    if (minor >= 40) return '机械-其他'
    return '通用机械'
  }

  return '材料'
}

/**
 * 解析一页或多页的定额文本
 * @param {string} text - PDF 提取的纯文本
 * @returns {object} { quotaItems: [], resources: [], sections: [] }
 */
function parseQuotaText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  const result = {
    sections: [],   // 定额子目（大项）
    resources: [],  // 所有资源明细（去重后可直接导入定额库）
  }

  let currentSection = null
  let currentCategoryHint = '' // 人工 / 材料 / 机械

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // —— 检测定额章节标题 ——
    // 例如 "一、油浸式变压器安装"  "二、干式变压器安装"
    const titleMatch = line.match(/^[一二三四五六七八九十]+、\s*(.+)/)
    if (titleMatch) {
      currentSection = {
        title: titleMatch[1].trim(),
        subItems: [],
      }
      result.sections.push(currentSection)
      continue
    }

    // —— 检测定额编号行 ——
    // 例如 "定 额 编 号  4-1-1  4-1-2  4-1-3"
    const codeLineMatch = line.match(/定\s*额\s*编\s*号\s+([\d\-\s]+)/)
    if (codeLineMatch) {
      const codes = codeLineMatch[1].trim().split(/\s+/)
      if (currentSection) {
        codes.forEach(code => {
          currentSection.subItems.push({ code, resources: [] })
        })
      }
      continue
    }

    // —— 检测类别标记 ——
    if (/^人工/.test(line)) { currentCategoryHint = 'labor'; continue }
    if (/^材/.test(line) && line.length <= 2) { currentCategoryHint = 'material'; continue }
    if (/^料/.test(line) && line.length <= 2) { currentCategoryHint = 'material'; continue }
    if (/^机/.test(line) && line.length <= 2) { currentCategoryHint = 'rental'; continue }
    if (/^械/.test(line) && line.length <= 2) { currentCategoryHint = 'rental'; continue }

    // —— 解析资源行 ——
    // 格式：编码(8位) 名称 [规格] 单位 单价 [消耗量1 消耗量2 ...]
    // 例如：01030063 镀锌低碳钢丝 φ4.06～2.34  kg  5.89  1.000  1.000  1.000  2.500  2.500
    const resourceMatch = line.match(
      /^(\d{8})\s+(.+?)\s+([\w\u4e00-\u9fff²³·]+)\s+([\d.]+)\s+([\d.\s—-]*)/
    )
    if (resourceMatch) {
      const [, code, rawName, unit, priceStr, quantitiesStr] = resourceMatch

      // 分离名称和规格
      const { name, spec } = splitNameSpec(rawName)

      const unitPrice = parseFloat(priceStr) || 0
      const category = currentCategoryHint || codeToCategory(code)

      // 解析各子目的消耗量
      const quantities = (quantitiesStr || '').trim().split(/\s+/)
        .map(v => v === '—' || v === '-' ? 0 : parseFloat(v) || 0)

      const resource = {
        code,
        category,
        subCategory: codeToSubCategory(code),
        name,
        spec,
        unit,
        unit_price: unitPrice,
        quantities,
        work_hours: category === 'labor' ? unitPrice : 0,
        remark: '',
      }

      result.resources.push(resource)

      // 关联到当前子目
      if (currentSection) {
        currentSection.subItems.forEach((sub, idx) => {
          if (quantities[idx] !== undefined) {
            sub.resources.push({ ...resource, quantity: quantities[idx] })
          }
        })
      }

      continue
    }

    // —— 尝试匹配没有 8 位编码但有类别标记的行（宽松模式）——
    // 例如 "人工 00010003 三类综合用工  工日 135.00 ..."
    const looseLine = line.match(
      /(?:人工|材料?|机械?)\s*(\d{8})\s+(.+?)\s+([\w\u4e00-\u9fff²³·]+)\s+([\d.]+)\s*([\d.\s—-]*)/
    )
    if (looseLine) {
      const [, code, rawName, unit, priceStr, quantitiesStr] = looseLine
      const { name, spec } = splitNameSpec(rawName)
      const unitPrice = parseFloat(priceStr) || 0
      const category = codeToCategory(code)
      const quantities = (quantitiesStr || '').trim().split(/\s+/)
        .map(v => v === '—' || v === '-' ? 0 : parseFloat(v) || 0)

      result.resources.push({
        code,
        category,
        subCategory: codeToSubCategory(code),
        name,
        spec,
        unit,
        unit_price: unitPrice,
        quantities,
        work_hours: category === 'labor' ? unitPrice : 0,
        remark: '',
      })
      continue
    }
  }

  return result
}

/**
 * 从 "名称+规格" 混合字符串中分离出名称和规格
 * 例如：
 *   "镀锌低碳钢丝 φ4.06～2.34" → { name: "镀锌低碳钢丝", spec: "φ4.06～2.34" }
 *   "防锈漆 C53-1"              → { name: "防锈漆", spec: "C53-1" }
 *   "三类综合用工"               → { name: "三类综合用工", spec: "" }
 */
function splitNameSpec(raw) {
  raw = raw.trim()

  // 尝试用空格分割
  const parts = raw.split(/\s+/)
  if (parts.length >= 2) {
    // 第一部分是名称，剩余的是规格
    return { name: parts[0], spec: parts.slice(1).join(' ') }
  }

  // 尝试用特殊字符分隔（φ、DN、×、数字开头的规格）
  const specMatch = raw.match(/^([\u4e00-\u9fff]+)\s*([\dφΦDNdn×].*)$/)
  if (specMatch) {
    return { name: specMatch[1], spec: specMatch[2] }
  }

  return { name: raw, spec: '' }
}

/**
 * 对解析出的资源列表去重，合并相同编码的条目
 * @param {Array} resources
 * @returns {Array} 去重后的资源列表
 */
function deduplicateResources(resources) {
  const map = new Map()
  for (const r of resources) {
    const key = `${r.code}_${r.name}_${r.spec}`
    if (!map.has(key)) {
      map.set(key, { ...r })
    }
    // 如果重复出现，保留单价较高的（通常更准确）
  }
  return Array.from(map.values())
}

/**
 * 将解析出的资源转换为定额库的标准格式（可直接导入 bulkCreateQuotaItems）
 */
function resourcesToQuotaItems(resources) {
  return deduplicateResources(resources).map(r => ({
    category: r.category,
    name: r.name,
    spec: r.spec,
    unit: r.unit,
    unit_price: r.unit_price,
    work_hours: r.work_hours || 0,
    remark: r.code ? `编码:${r.code}` : '',
  }))
}

/**
 * 使用 poppler pdftotext 提取 PDF 文本（中文嵌入字体兼容性更好）
 * @param {string} filePath
 * @returns {{ text: string, pageCount: number } | null} 失败返回 null
 */
function extractWithPdftotext(filePath) {
  try {
    const text = execFileSync('pdftotext', ['-layout', filePath, '-'], {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    })
    // 用 pdfinfo 获取页数
    let pageCount = 0
    try {
      const info = execFileSync('pdfinfo', [filePath], { encoding: 'utf-8' })
      const m = info.match(/Pages:\s*(\d+)/)
      if (m) pageCount = parseInt(m[1], 10)
    } catch { /* 页数获取失败不影响解析 */ }
    return { text, pageCount }
  } catch {
    return null
  }
}

/**
 * 解析 PDF 文件并返回可导入的定额数据
 * 优先使用 poppler pdftotext（中文字体兼容性好），失败则回退到 pdf-parse
 * @param {string} filePath - PDF 文件路径
 * @returns {Promise<object>} { items: [], sections: [], rawText: '' }
 */
async function parsePdfQuota(filePath) {
  let text, pageCount

  // 优先尝试 pdftotext（poppler），对中文嵌入字体的兼容性更好
  const popplerResult = extractWithPdftotext(filePath)
  if (popplerResult && popplerResult.text.trim().length > 0) {
    console.log('[quotaParser] 使用 poppler pdftotext 提取:', filePath)
    text = popplerResult.text
    pageCount = popplerResult.pageCount
  } else {
    console.log('[quotaParser] 回退到 pdf-parse (pdfjs-dist):', filePath)
    // 回退到 pdf-parse (pdfjs-dist)
    const buffer = fs.readFileSync(filePath)
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    const result = await parser.getText()
    text = result.text
    pageCount = result.total
  }

  const parsed = parseQuotaText(text)
  const items = resourcesToQuotaItems(parsed.resources)

  return {
    items,
    sections: parsed.sections,
    rawResources: parsed.resources,
    rawText: text,
    pageCount,
  }
}

/**
 * 批量解析多个 PDF 文件
 * @param {string[]} filePaths
 * @returns {Promise<object>}
 */
async function parsePdfQuotaBatch(filePaths) {
  let allItems = []
  let allSections = []
  let totalPages = 0

  for (const fp of filePaths) {
    const result = await parsePdfQuota(fp)
    allItems = allItems.concat(result.items)
    allSections = allSections.concat(result.sections)
    totalPages += result.pageCount
  }

  // 全局去重
  const seen = new Map()
  const dedupedItems = []
  for (const item of allItems) {
    const key = `${item.category}_${item.name}_${item.spec}`
    if (!seen.has(key)) {
      seen.set(key, true)
      dedupedItems.push(item)
    }
  }

  return {
    items: dedupedItems,
    sections: allSections,
    totalPages,
    totalFiles: filePaths.length,
  }
}

module.exports = {
  parseQuotaText,
  parsePdfQuota,
  parsePdfQuotaBatch,
  resourcesToQuotaItems,
  deduplicateResources,
  splitNameSpec,
  codeToCategory,
}
