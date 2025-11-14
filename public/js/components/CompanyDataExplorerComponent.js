/**
 * CompanyDataExplorerComponent - Read-only explorer for all company tables
 * - Select a company
 * - Loads its saved structure (nodeTypes + derived relationships)
 * - Fetches all used type tables via dynamic CRUD endpoints
 * - Renders one table per type with columns based on the data structure
 * - Shows parent relationship label using displayAttr when single parent exists
 * - Per-table search + pagination
 * - Combined view switch: one merged table across all types (without raw *_id)
 */
class CompanyDataExplorerComponent {
  constructor(container) {
    this.container = container

    // State
    this.companyId = null
    this.companies = []
    this.structure = null

    // Derived from structure
    this.typesMap = {} // key -> typeDef
    this.childParent = {} // childType -> single parentType
    this.multiParent = {} // childType -> true if multiple parents discovered
    this.usedTypes = [] // types appearing in the saved tree

    // Data
    this.dataByType = {} // typeKey -> array of rows
    this.parentItemMap = {} // parentType -> Map(id -> row) for quick label lookup

    // UI
    this.loading = false
    this.error = null

    // Explorer UI state
    this.searchByType = {}
    this.pageByType = {}
    this.pageSize = 10
    this.combinedView = false
    this.combinedSearch = ''
    this.combinedPage = 1

    this.init()
  }

  // ---------- Lifecycle ----------
  async init() {
    this.renderShell()
    await this.loadCompanies()
    this.render()
  }

  // ---------- API helpers ----------
  apiBase() {
    return window.API_BASE || '../backend/api'
  }

  async getJson(path) {
    return window.getJson(path)
  }

  // ---------- Data loading ----------
  async loadCompanies() {
    try {
      const res = await this.getJson('/companies')
      this.companies = Array.isArray(res) ? res : res.items || []
    } catch (e) {
      this.companies = []
    }
  }

  async loadStructure() {
    if (!this.companyId) return
    this.loading = true
    this.renderHeader() // immediate feedback
    try {
      const res = await this.getJson(
        `/companies/${this.companyId}/machine-structure`
      )
      this.structure =
        res && res.structure
          ? res.structure
          : { nodeTypes: [], rules: [], tree: { type: 'root', children: [] } }
      this.rebuildMaps()
    } catch (e) {
      this.structure = {
        nodeTypes: [],
        rules: [],
        tree: { type: 'root', children: [] },
      }
      this.typesMap = {}
      this.childParent = {}
      this.multiParent = {}
      this.usedTypes = []
    } finally {
      this.loading = false
    }
  }

  rebuildMaps() {
    // Types
    this.typesMap = {}
    for (const nt of this.structure?.nodeTypes || []) {
      if (nt && nt.key) this.typesMap[nt.key] = nt
    }

    // Relationships from explicit rules
    this.childParent = {}
    this.multiParent = {}
    for (const r of this.structure?.rules || []) {
      const p = r?.parent
      const c = r?.child
      if (!p || !c) continue
      if (!this.childParent[c]) this.childParent[c] = p
      else if (this.childParent[c] !== p) this.multiParent[c] = true
    }

    // Merge relationships derived from actual tree ordering
    const {
      childParent: treeCP,
      multiParent: treeMP,
      usedTypes,
    } = this.deriveFromTree(this.structure?.tree)
    for (const c of Object.keys(treeCP)) {
      const p = treeCP[c]
      if (!this.childParent[c]) this.childParent[c] = p
      else if (this.childParent[c] !== p) this.multiParent[c] = true
    }
    for (const c of Object.keys(treeMP)) {
      this.multiParent[c] = true
    }

    // Used types discovered from tree
    const unique = Array.from(new Set(usedTypes))
    this.usedTypes = unique.filter((k) => !!this.typesMap[k])
  }

  deriveFromTree(root) {
    const childParent = {}
    const multiParent = {}
    const usedTypes = []

    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      const parentType = node.type || 'root'
      const children = Array.isArray(node.children) ? node.children : []
      for (const ch of children) {
        if (!ch || typeof ch !== 'object') continue
        const childType = ch.type
        if (childType && childType !== 'root') usedTypes.push(childType)
        if (
          parentType &&
          childType &&
          parentType !== 'root' &&
          childType !== 'root' &&
          parentType !== childType
        ) {
          if (!childParent[childType]) childParent[childType] = parentType
          else if (childParent[childType] !== parentType)
            multiParent[childType] = true
        }
        walk(ch)
      }
    }

    walk(root || { type: 'root', children: [] })
    return { childParent, multiParent, usedTypes }
  }

  sanitizeIdent(raw) {
    let id = String(raw || '')
      .replace(/[^a-zA-Z0-9_]+/g, '_')
      .toLowerCase()
    id = id.replace(/^_+|_+$/g, '')
    if (!id || /\d/.test(id[0])) id = 'f_' + id
    return id
  }

  parentType(typeKey) {
    if (this.multiParent[typeKey]) return null
    return this.childParent[typeKey] || null
  }

  async loadAllTypeData() {
    if (!this.companyId) return
    this.dataByType = {}
    this.parentItemMap = {}

    // Fetch all used types
    for (const tk of this.usedTypes) {
      try {
        const data = await this.getJson(
          `/companies/${this.companyId}/data/${encodeURIComponent(tk)}`
        )
        const items = Array.isArray(data?.items) ? data.items : []
        this.dataByType[tk] = items
      } catch (e) {
        this.dataByType[tk] = []
      }
    }

    // Build parent maps to show parent label columns
    for (const child of this.usedTypes) {
      const pType = this.parentType(child)
      if (!pType) continue
      // Ensure parent data present
      if (!this.dataByType[pType]) {
        try {
          const res = await this.getJson(
            `/companies/${this.companyId}/data/${encodeURIComponent(pType)}`
          )
          this.dataByType[pType] = Array.isArray(res?.items) ? res.items : []
        } catch (e) {
          this.dataByType[pType] = []
        }
      }
      // Build map
      const map = new Map()
      for (const row of this.dataByType[pType]) {
        map.set(row.id, row)
      }
      this.parentItemMap[pType] = map
    }
  }

  // ---------- Rendering ----------
  renderShell() {
    this.container.innerHTML = `
      <div class="ms-card">
        <div class="hd">Company Data Explorer</div>
        <div class="bd">
          <div id="cde-header"></div>
          <div id="cde-body"></div>
        </div>
      </div>
    `

    const style = document.createElement('style')
    style.textContent = `
      .cde-row { display:flex; align-items:center; gap:10px; flex-wrap: wrap; margin-bottom: 10px; }
      .cde-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
      .cde-section { border: 1px solid #e5e7eb; border-radius: 8px; background:#fff; }
      .cde-section .hd { padding: 8px 10px; font-weight: 600; border-bottom: 1px solid #f3f4f6; }
      .cde-section .bd { padding: 10px; overflow:auto; }
      .cde-table { width: 100%; border-collapse: collapse; }
      .cde-table th, .cde-table td { text-align:left; border-bottom:1px solid #e5e7eb; padding:6px 8px; }
      .cde-table th { background:#f9fafb; }
      .small.muted { color:#6b7280; font-size:12px; }
      .ms-select, .ms-input, .ms-btn { height: auto; }
      .spacer { flex: 1; }
      .cde-pager { margin-top: 10px; }
    `
    this.container.appendChild(style)
  }

  render() {
    this.renderHeader()
    this.renderBody()
  }

  renderHeader() {
    const mount = this.container.querySelector('#cde-header')
    if (!mount) return
    const wrap = document.createElement('div')
    wrap.className = 'cde-row'

    // Company select (or number input)
    let companyCtl
    if (this.companies.length) {
      companyCtl = document.createElement('select')
      companyCtl.className = 'ms-select'
      companyCtl.appendChild(new Option('Select Company', ''))
      for (const co of this.companies) {
        companyCtl.appendChild(new Option(co.name, String(co.id)))
      }
      companyCtl.value = this.companyId ? String(this.companyId) : ''
      companyCtl.addEventListener('change', async (e) => {
        const val = e.target.value
        const v = parseInt(val, 10)
        if (!val) {
          this.companyId = null
          this.structure = null
          this.typesMap = {}
          this.dataByType = {}
          this.renderHeader()
          this.renderBody()
          return
        }
        if (!isNaN(v) && v > 0) {
          this.companyId = v
          this.loading = true
          this.renderHeader()
          try {
            await this.loadStructure()
            await this.loadAllTypeData()
          } finally {
            this.loading = false
            this.renderHeader()
            this.renderBody()
          }
        }
      })
    } else {
      companyCtl = document.createElement('input')
      companyCtl.type = 'number'
      companyCtl.min = '1'
      companyCtl.value = this.companyId || ''
      companyCtl.className = 'ms-input'
      companyCtl.style.width = '160px'
      companyCtl.addEventListener('change', async (e) => {
        const v = parseInt(e.target.value, 10)
        if (!isNaN(v) && v > 0) {
          this.companyId = v
          this.loading = true
          this.renderHeader()
          try {
            await this.loadStructure()
            await this.loadAllTypeData()
          } finally {
            this.loading = false
            this.renderHeader()
            this.renderBody()
          }
        }
      })
    }

    // Buttons
    const btnReload = this.button(
      this.loading ? 'Loading...' : 'Reload',
      async () => {
        if (!this.companyId) return
        // Show loading state in header immediately and clear when done
        this.loading = true
        this.renderHeader()
        try {
          await this.loadStructure()
          await this.loadAllTypeData()
        } finally {
          this.loading = false
          this.renderHeader()
          this.renderBody()
        }
      }
    )

    wrap.appendChild(this.h('label', 'small muted', 'Company'))
    wrap.appendChild(companyCtl)
    wrap.appendChild(this.h('span', 'small muted', ' | '))
    wrap.appendChild(btnReload)
    wrap.appendChild(this.h('span', 'spacer', ''))

    // Combined view toggle
    const toggleWrap = document.createElement('label')
    toggleWrap.className = 'small muted'
    const chk = document.createElement('input')
    chk.type = 'checkbox'
    chk.style.marginRight = '6px'
    chk.checked = this.combinedView
    chk.addEventListener('change', () => {
      this.combinedView = !!chk.checked
      this.combinedPage = 1
      this.renderBody()
    })
    toggleWrap.appendChild(chk)
    toggleWrap.appendChild(document.createTextNode('Combined view'))
    wrap.appendChild(toggleWrap)

    mount.innerHTML = ''
    mount.appendChild(wrap)
  }

  renderBody() {
    const mount = this.container.querySelector('#cde-body')
    if (!mount) return
    mount.innerHTML = ''

    if (!this.companyId) {
      mount.appendChild(this.h('div', 'small muted', 'Select a company'))
      return
    }
    if (!this.structure) {
      mount.appendChild(
        this.h('div', 'small muted', 'No structure for this company')
      )
      return
    }
    // If usedTypes is empty, derive a fallback from tree (top-level children) or nodeTypes list
    if (!this.usedTypes || this.usedTypes.length === 0) {
      const fallback = []
      try {
        const root =
          this.structure && this.structure.tree
            ? this.structure.tree
            : { children: [] }
        const children = Array.isArray(root.children) ? root.children : []
        for (const ch of children) {
          if (ch && ch.type && ch.type !== 'root') fallback.push(ch.type)
        }
      } catch (e) {}
      if (!fallback.length) {
        const keys = (this.structure.nodeTypes || [])
          .map((t) => t && t.key)
          .filter(Boolean)
        this.usedTypes = Array.from(new Set(keys))
      } else {
        this.usedTypes = Array.from(new Set(fallback)).filter(
          (k) => this.typesMap[k]
        )
      }
      if (!this.usedTypes.length) {
        mount.appendChild(
          this.h('div', 'small muted', 'No types found for this company')
        )
        return
      }
    }

    if (this.combinedView) {
      mount.appendChild(this.renderCombinedSection())
      return
    }

    const grid = document.createElement('div')
    grid.className = 'cde-grid'

    // Render a section per used type
    for (const tk of this.usedTypes) {
      grid.appendChild(this.renderTypeSection(tk))
    }

    mount.appendChild(grid)
  }

  renderCombinedSection() {
    const sec = document.createElement('div')
    sec.className = 'cde-section'
    sec.appendChild(this.h('div', 'hd', 'Combined View'))

    const body = document.createElement('div')
    body.className = 'bd'

    // Controls row (search top right, preserve caret/focus)
    const controls = document.createElement('div')
    controls.className = 'cde-row'
    controls.appendChild(this.h('span', 'spacer', ''))
    const search = document.createElement('input')
    search.className = 'ms-input'
    search.id = 'cde-search-combined'
    search.placeholder = 'Search...'
    search.value = this.combinedSearch || ''
    search.addEventListener('input', (e) => {
      const caret = e.target.selectionStart
      this.combinedSearch = e.target.value
      this.combinedPage = 1
      this.renderBody()
      const el = this.container.querySelector('#cde-search-combined')
      if (el) {
        el.focus()
        try {
          el.setSelectionRange(caret, caret)
        } catch {}
      }
    })
    controls.appendChild(search)
    body.appendChild(controls)

    // Build union headers (exclude raw *_id, include labels only)
    const headerCols = ['type', '#']
    const parentTypes = new Set()
    const attrCols = new Set()

    for (const tk of this.usedTypes) {
      const pType = this.parentType(tk)
      if (pType) parentTypes.add(pType)
      const def = this.typesMap[tk] || {}
      const attrs = Array.isArray(def.attributes) ? def.attributes : []
      for (const a of attrs) {
        const key = a && a.key ? this.sanitizeIdent(a.key) : ''
        if (key) attrCols.add(key)
      }
    }

    // map label headers for parents
    const parentLabelMap = new Map()
    for (const pt of Array.from(parentTypes)) {
      const col = `${this.sanitizeIdent(pt)}_id__label`
      parentLabelMap.set(col, pt)
      headerCols.push(col)
    }
    for (const c of Array.from(attrCols)) headerCols.push(c)

    // Build combined rows
    let rows = []
    for (const tk of this.usedTypes) {
      const items = this.dataByType[tk] || []
      for (const r of items) {
        rows.push({ __type: tk, ...r })
      }
    }

    // Filter
    const q = (this.combinedSearch || '').toLowerCase()
    if (q) {
      rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
    }

    // Paginate
    const totalPages = Math.max(1, Math.ceil(rows.length / this.pageSize))
    const curr = Math.min(this.combinedPage || 1, totalPages)
    this.combinedPage = curr
    const start = (curr - 1) * this.pageSize
    const pageRows = rows.slice(start, start + this.pageSize)

    // Table
    const table = document.createElement('table')
    table.className = 'cde-table'
    const thead = document.createElement('thead')
    const thr = document.createElement('tr')
    for (const c of headerCols) {
      const th = document.createElement('th')
      th.textContent = c
      thr.appendChild(th)
    }
    thead.appendChild(thr)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    if (!pageRows.length) {
      const tr = document.createElement('tr')
      const td = document.createElement('td')
      td.colSpan = headerCols.length
      td.textContent = 'No items'
      tr.appendChild(td)
      tbody.appendChild(tr)
    } else {
      pageRows.forEach((row, idx) => {
        const tr = document.createElement('tr')
        for (const c of headerCols) {
          const td = document.createElement('td')
          let v = null
          if (c === 'type') {
            v = row.__type
          } else if (c === '#') {
            v = start + idx + 1
          } else if (c.endsWith('__label')) {
            const pType = parentLabelMap.get(c)
            if (pType) {
              const baseIdCol = c.replace('__label', '')
              const pid = row[baseIdCol]
              const pMap = this.parentItemMap[pType]
              const pRow = pMap ? pMap.get(pid) : null
              if (pRow) {
                const pDef = this.typesMap[pType] || {}
                const displayKey =
                  pDef && pDef.displayAttr ? pDef.displayAttr : 'name'
                v = pRow[displayKey] || pRow.name || `#${pRow.id}`
              } else {
                v = ''
              }
            }
          } else {
            v = row[c]
            // map audit columns to current user's email (best effort)
            if ((c === 'created_by' || c === 'updated_by') && v != null) {
              const cur = this.currentUser && this.currentUser()
              if (cur && String(v) === String(cur.id)) {
                v = cur.email || v
              }
            }
            if (typeof v === 'object' && v !== null) v = JSON.stringify(v)
          }
          td.textContent = v == null ? '' : String(v)
          tr.appendChild(td)
        }
        tbody.appendChild(tr)
      })
    }
    table.appendChild(tbody)
    body.appendChild(table)

    // Pager
    const pager = document.createElement('div')
    pager.className = 'cde-row cde-pager'
    pager.style.justifyContent = 'flex-end'
    const info = this.h('span', 'small muted', `Page ${curr} of ${totalPages}`)
    const prev = this.button('Prev', () => {
      if (this.combinedPage > 1) {
        this.combinedPage -= 1
        this.renderBody()
      }
    })
    const next = this.button('Next', () => {
      if (this.combinedPage < totalPages) {
        this.combinedPage += 1
        this.renderBody()
      }
    })
    prev.disabled = curr <= 1
    next.disabled = curr >= totalPages
    pager.appendChild(info)
    pager.appendChild(prev)
    pager.appendChild(next)
    body.appendChild(pager)

    sec.appendChild(body)
    return sec
  }

  renderTypeSection(typeKey) {
    const sec = document.createElement('div')
    sec.className = 'cde-section'

    const def = this.typesMap[typeKey] || { key: typeKey, attributes: [] }
    const title = def.label || typeKey
    sec.appendChild(this.h('div', 'hd', `${title} (${typeKey})`))

    const body = document.createElement('div')
    body.className = 'bd'

    // Controls (search top-right) with focus preservation
    const controls = document.createElement('div')
    controls.className = 'cde-row'
    controls.appendChild(this.h('span', 'spacer', ''))
    const search = document.createElement('input')
    search.className = 'ms-input'
    const searchId = `cde-search-${this.sanitizeIdent(typeKey)}`
    search.id = searchId
    search.placeholder = 'Search...'
    search.value = this.searchByType[typeKey] || ''
    search.addEventListener('input', (e) => {
      const caret = e.target.selectionStart
      this.searchByType[typeKey] = e.target.value
      this.pageByType[typeKey] = 1
      this.renderBody()
      const el = this.container.querySelector(`#${searchId}`)
      if (el) {
        el.focus()
        try {
          el.setSelectionRange(caret, caret)
        } catch {}
      }
    })
    controls.appendChild(search)
    body.appendChild(controls)

    const table = document.createElement('table')
    table.className = 'cde-table'

    const thead = document.createElement('thead')
    const thr = document.createElement('tr')
    const headerCols = ['#']

    // Parent column if single parent exists
    const pType = this.parentType(typeKey)
    let parentCol = null
    if (pType) {
      parentCol = `${this.sanitizeIdent(pType)}_id`
      // Keep raw id in per-table view, and also show label
      headerCols.push(parentCol)
      headerCols.push(`${parentCol}__label`)
    }

    // Attribute columns from structure
    const attrs = Array.isArray(def.attributes) ? def.attributes : []
    const attrCols = attrs.map((a) => this.sanitizeIdent(a.key))
    for (const c of attrCols) headerCols.push(c)

    // Include any extra columns present in data (created_at, etc.), excluding DB 'id'
    const firstItem =
      Array.isArray(this.dataByType[typeKey]) && this.dataByType[typeKey].length
        ? this.dataByType[typeKey][0]
        : null
    if (firstItem && typeof firstItem === 'object') {
      for (const k of Object.keys(firstItem)) {
        if (k === 'id') continue // omit DB id
        if (!headerCols.includes(k)) headerCols.push(k)
      }
    }

    for (const c of headerCols) {
      const th = document.createElement('th')
      th.textContent = c
      thr.appendChild(th)
    }
    thead.appendChild(thr)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')

    // Search + paginate
    const allRows = this.dataByType[typeKey] || []
    const q = (this.searchByType[typeKey] || '').toLowerCase()
    const filtered = q
      ? allRows.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
      : allRows
    const totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize))
    const curr = Math.min(this.pageByType[typeKey] || 1, totalPages)
    this.pageByType[typeKey] = curr
    const start = (curr - 1) * this.pageSize
    const rows = filtered.slice(start, start + this.pageSize)

    if (!rows.length) {
      const tr = document.createElement('tr')
      const td = document.createElement('td')
      td.colSpan = headerCols.length
      td.textContent = 'No items'
      tr.appendChild(td)
      tbody.appendChild(tr)
    } else {
      rows.forEach((row, idx) => {
        const tr = document.createElement('tr')
        for (const c of headerCols) {
          const td = document.createElement('td')
          let v = null

          if (c === '#') {
            v = start + idx + 1
          } else if (c.endsWith('__label')) {
            v = ''
            if (pType && parentCol) {
              const pid = row[parentCol]
              const pMap = this.parentItemMap[pType]
              const pRow = pMap ? pMap.get(pid) : null
              if (pRow) {
                const pDef = this.typesMap[pType] || {}
                const displayKey =
                  pDef && pDef.displayAttr ? pDef.displayAttr : 'name'
                v = pRow[displayKey] || pRow.name || `#${pRow.id}`
              }
            }
          } else {
            v = row[c]
            // map audit columns to current user's email (best effort)
            if ((c === 'created_by' || c === 'updated_by') && v != null) {
              const cur = this.currentUser && this.currentUser()
              if (cur && String(v) === String(cur.id)) {
                v = cur.email || v
              }
            }
            if (typeof v === 'object' && v !== null) {
              v = JSON.stringify(v)
            }
          }

          td.textContent = v == null ? '' : String(v)
          tr.appendChild(td)
        }
        tbody.appendChild(tr)
      })
    }
    table.appendChild(tbody)

    body.appendChild(table)

    // Pager
    const pager = document.createElement('div')
    pager.className = 'cde-row cde-pager'
    pager.style.justifyContent = 'flex-end'
    const info = this.h('span', 'small muted', `Page ${curr} of ${totalPages}`)
    const prev = this.button('Prev', () => {
      if (this.pageByType[typeKey] > 1) {
        this.pageByType[typeKey] -= 1
        this.renderBody()
      }
    })
    const next = this.button('Next', () => {
      if (this.pageByType[typeKey] < totalPages) {
        this.pageByType[typeKey] += 1
        this.renderBody()
      }
    })
    prev.disabled = curr <= 1
    next.disabled = curr >= totalPages
    pager.appendChild(info)
    pager.appendChild(prev)
    pager.appendChild(next)
    body.appendChild(pager)

    sec.appendChild(body)
    return sec
  }

  // ---------- UI utils / helpers ----------
  currentUser() {
    if (this._curUser !== undefined) return this._curUser
    try {
      const t = localStorage.getItem('token') || ''
      if (!t) {
        this._curUser = null
        return null
      }
      const parts = t.split('.')
      if (parts.length < 2) {
        this._curUser = null
        return null
      }
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const json = decodeURIComponent(
        atob(b64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      )
      const payload = JSON.parse(json)
      this._curUser = { id: payload.sub, email: payload.email || '' }
      return this._curUser
    } catch (e) {
      this._curUser = null
      return null
    }
  }

  button(label, onClick, variant = '') {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ms-btn' + (variant ? ` ${variant}` : '')
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  h(tag, className, text) {
    const el = document.createElement(tag)
    if (className) el.className = className
    if (text != null) el.textContent = text
    return el
  }

  destroy() {
    this.container.innerHTML = ''
  }
}

// Expose globally for app.js registration
window.CompanyDataExplorerComponent = CompanyDataExplorerComponent
