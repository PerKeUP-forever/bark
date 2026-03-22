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

// CMap 文件路径，用于正确解析中文嵌入字体
const CMAP_URL = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps') + path.sep

// ---- 资源编码前缀 → 类别映射 ----
function codeToCategory(code) {
  if (!code) return 'material'
  const prefix = code.substring(0, 2)
  const n = parseInt(prefix, 10)
  if (n === 0) return 'labor'        // 00 = 人工
  if (n >= 98) return 'rental'       // 98-99 = 机械
  return 'material'                   // 01-37 = 材料
}

// 资源编码前缀 → 更细的中文类别描述
function codeToSubCategory(code) {
  if (!code) return ''
  const prefix = code.substring(0, 2)
  const n = parseInt(prefix, 10)
  if (n === 0) return '人工'
  if (n === 1) return '金属材料'
  if (n === 2) return '非金属材料'
  if (n === 3) return '焊接材料'
  if (n >= 13 && n <= 13) return '涂料'
  if (n === 14) return '油料/气体'
  if (n >= 27 && n <= 37) return '辅材'
  if (n === 98) return '专用仪器'
  if (n === 99) return '通用机械'
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
 * 解析 PDF 文件并返回可导入的定额数据
 * @param {string} filePath - PDF 文件路径
 * @returns {Promise<object>} { items: [], sections: [], rawText: '' }
 */
async function parsePdfQuota(filePath) {
  const buffer = fs.readFileSync(filePath)
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
  })
  const result = await parser.getText()
  const text = result.text

  const parsed = parseQuotaText(text)
  const items = resourcesToQuotaItems(parsed.resources)

  return {
    items,
    sections: parsed.sections,
    rawResources: parsed.resources,
    rawText: text,
    pageCount: result.total,
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
