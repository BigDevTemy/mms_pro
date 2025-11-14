/**
 * MachineStruture - MVP hierarchy builder per company
 * - Loads/saves JSON structure via /companies/:id/machine-structure
 * - Simple tree editor (add child, edit attributes, reorder, delete)
 * - Uses nodeTypes + rules from server to validate allowed children
 *
 * Note: this is an MVP without drag-and-drop; it provides structured add/move operations.
 * You can enhance with HTML5 DnD later while reusing the same data model.
 */
class MachineStruture {
  constructor(container) {
    this.container = container
    this.companyId = null
    this.structure = null // { nodeTypes, rules, tree }
    this.companies = []
    this.selectedPath = [] // path into tree: e.g., [0, 1] means tree.children[0].children[1]
    this.loading = false
    this.saving = false
    this.applying = false
    this.error = null

    // Schema Designer state
    this.showTypesEditor = false
    this.editingTypeKey = ''

    this.init()
  }

  async init() {
    this.render()
    await this.loadCompanies()
    if (
      !this.companyId &&
      Array.isArray(this.companies) &&
      this.companies.length
    ) {
      this.companyId = this.companies[0].id
    }
    await this.loadStructure()
    this.attachGlobalHandlers()
  }

  // ---------------- API ----------------

  async loadStructure() {
    if (!this.companyId || isNaN(this.companyId)) return
    this.loading = true
    this.error = null
    this.render()
    try {
      const res = await window.getJson(
        `/companies/${this.companyId}/machine-structure`
      )
      // Expected { company_id, version, structure: {...} }
      if (res && res.structure) {
        // Ensure minimal shape
        this.structure = {
          nodeTypes: Array.isArray(res.structure.nodeTypes)
            ? res.structure.nodeTypes
            : [],
          rules: Array.isArray(res.structure.rules) ? res.structure.rules : [],
          tree:
            res.structure.tree && typeof res.structure.tree === 'object'
              ? res.structure.tree
              : { id: 'root', type: 'root', children: [] },
        }
      } else {
        // fallback default
        this.structure = this.defaultStructure()
      }
      // Safety: ensure tree has children array
      if (!Array.isArray(this.structure.tree.children)) {
        this.structure.tree.children = []
      }
      this.selectedPath = [] // nothing selected initially
    } catch (e) {
      // Fallback to default structure in read-only mode so UI remains usable (top-level dropdown works)
      this.structure = this.defaultStructure()
      const token = localStorage.getItem('token') || ''
      const baseMsg = e && e.error ? e.error : 'Failed to load structure'
      this.error = token
        ? baseMsg
        : baseMsg + ' (not logged in - read-only preview)'
    } finally {
      this.loading = false
      this.render()
    }
  }

  async loadCompanies() {
    try {
      const res = await window.getJson('/companies')
      const list = Array.isArray(res) ? res : res.items || []
      this.companies = list
    } catch (e) {
      this.companies = []
      // allow UI to fallback to manual ID input if not authenticated
    }
  }

  async saveStructure() {
    if (!this.companyId || isNaN(this.companyId) || !this.structure) return
    // Client-side validation before save
    const clientErrors = this.validateClient()
    if (clientErrors.length) {
      this.error = 'Validation failed: ' + clientErrors.join('; ')
      this.render()
      window.showToast(this.error, false)
      return
    }
    const token = localStorage.getItem('token') || ''
    if (!token) {
      this.error = 'Login required to save'
      window.showToast(this.error, false)
      this.render()
      return
    }
    this.saving = true
    this.error = null
    this.render()
    try {
      // Derive parent→child rules from current tree before saving
      this.structure.rules = this.deriveRulesFromTree()
      const url = `${this.apiBase()}/companies/${
        this.companyId
      }/machine-structure`
      const payload = { structure: this.structure, token } // include token fallback
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(token ? { 'X-Auth-Token': token } : {}),
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw data
      }
      window.showToast('Structure saved')
      // Optionally reload returned normalized structure
      if (data && data.structure) {
        this.structure = data.structure
      }
    } catch (e) {
      this.error = e && e.error ? e.error : 'Failed to save structure'
      window.showToast(this.error, false)
    } finally {
      this.saving = false
      this.render()
    }
  }

  async applySchema(breaking = false) {
    if (!this.companyId || isNaN(this.companyId)) return
    if (!this.structure) return
    const token = localStorage.getItem('token') || ''
    if (!token) {
      this.error = 'Login required to apply schema'
      window.showToast(this.error, false)
      this.render()
      return
    }

    // Validate locally before applying
    const clientErrors = this.validateClient()
    if (clientErrors.length) {
      this.error = 'Validation failed: ' + clientErrors.join('; ')
      window.showToast(this.error, false)
      this.render()
      return
    }

    this.applying = true
    this.error = null
    this.render()
    try {
      const url = `${this.apiBase()}/companies/${this.companyId}/schema/apply`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Auth-Token': token,
        },
        body: JSON.stringify({ breaking }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw data
      }
      const msg =
        data && data.version
          ? `Schema applied. Version ${data.version}`
          : 'Schema applied'
      window.showToast(msg, true)
    } catch (e) {
      this.error = e && e.error ? e.error : 'Failed to apply schema'
      window.showToast(this.error, false)
    } finally {
      this.applying = false
      this.render()
    }
  }

  apiBase() {
    // Leverage same base as app.js getJson helper
    // app.js prefixes all calls with ../backend/api; we mimic its behavior by inferring from a dummy call
    // Simpler: reuse the relative known path from app
    return window.API_BASE || '../backend/api'
  }

  // ------------- Structure helpers -------------

  defaultStructure() {
    return {
      nodeTypes: [
        {
          key: 'line',
          label: 'Line',
          displayAttr: 'name',
          attributes: [{ key: 'name', type: 'string', required: true }],
        },
        {
          key: 'subline',
          label: 'Subline',
          displayAttr: 'name',
          attributes: [{ key: 'name', type: 'string', required: true }],
        },
        {
          key: 'machine',
          label: 'Machine',
          displayAttr: 'name',
          attributes: [{ key: 'name', type: 'string', required: true }],
        },
        {
          key: 'project',
          label: 'Project',
          displayAttr: 'name',
          attributes: [{ key: 'name', type: 'string', required: true }],
        },
        {
          key: 'unit',
          label: 'Unit',
          displayAttr: 'name',
          attributes: [{ key: 'name', type: 'string', required: true }],
        },
        {
          key: 'subunit',
          label: 'SubUnit',
          displayAttr: 'name',
          attributes: [{ key: 'name', type: 'string', required: true }],
        },
      ],
      rules: [],
      tree: { id: 'root', type: 'root', children: [] },
    }
  }

  // Derive parent→child rules from current tree ordering
  deriveRulesFromTree() {
    const rules = new Set()
    const root =
      this.structure && this.structure.tree
        ? this.structure.tree
        : { type: 'root', children: [] }

    const push = (p, c) => {
      if (!p || p === 'root') return
      if (!c || c === 'root') return
      if (p === c) return
      rules.add(`${p}>${c}`)
    }

    const walk = (node) => {
      if (!node) return
      const parentType = node.type || 'root'
      const children = Array.isArray(node.children) ? node.children : []
      for (const ch of children) {
        const childType = ch && ch.type
        push(parentType, childType)
        walk(ch)
      }
    }

    walk(root)

    const out = []
    for (const key of rules) {
      const [parent, child] = key.split('>')
      out.push({ parent, child })
    }
    return out
  }

  getTypeDef(typeKey) {
    if (!this.structure) return null
    if (typeKey === 'root')
      return { key: 'root', label: 'Root', attributes: [] }
    return this.structure.nodeTypes.find((t) => t.key === typeKey) || null
  }

  allowedChildTypeKeys(parentType) {
    if (!this.structure) return []
    const all = (this.structure.nodeTypes || []).map((t) => t.key)

    // Build a set of types already acting as a parent anywhere in the current tree
    const usedAsParent = new Set()
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return
      if (node.type && node.type !== 'root' && node.children.length > 0) {
        usedAsParent.add(node.type)
      }
      for (const ch of node.children) walk(ch)
    }
    walk(this.structure.tree || { children: [] })

    // Candidates are any defined types that are NOT already used as a parent
    let candidates = all.filter((k) => !usedAsParent.has(k))

    // Optional: avoid selecting the same type as the current parent to reduce confusion
    if (parentType && parentType !== 'root') {
      candidates = candidates.filter((k) => k !== parentType)
    }

    return candidates
  }

  // Get node by path; path is array of indices under root.children
  getNodeByPath(path) {
    if (!Array.isArray(path)) return null
    let node = this.structure.tree // root
    if (path.length === 0) return node
    for (const idx of path) {
      if (
        !node.children ||
        !Array.isArray(node.children) ||
        idx < 0 ||
        idx >= node.children.length
      ) {
        return null
      }
      node = node.children[idx]
    }
    return node
  }

  setNodeByPath(path, newNode) {
    if (path.length === 0) {
      this.structure.tree = newNode
      return
    }
    const parentPath = path.slice(0, -1)
    const idx = path[path.length - 1]
    const parent = this.getNodeByPath(parentPath)
    if (
      !parent ||
      !Array.isArray(parent.children) ||
      idx < 0 ||
      idx >= parent.children.length
    )
      return
    parent.children[idx] = newNode
  }

  removeNodeByPath(path) {
    if (path.length === 0) return // do not remove root
    const parentPath = path.slice(0, -1)
    const idx = path[path.length - 1]
    const parent = this.getNodeByPath(parentPath)
    if (
      !parent ||
      !Array.isArray(parent.children) ||
      idx < 0 ||
      idx >= parent.children.length
    )
      return
    parent.children.splice(idx, 1)
  }

  moveNode(path, dir) {
    // dir: -1 up, +1 down among siblings
    if (path.length === 0) return
    const parentPath = path.slice(0, -1)
    const idx = path[path.length - 1]
    const parent = this.getNodeByPath(parentPath)
    if (!parent || !Array.isArray(parent.children)) return
    const target = idx + dir
    if (target < 0 || target >= parent.children.length) return
    const tmp = parent.children[idx]
    parent.children[idx] = parent.children[target]
    parent.children[target] = tmp
    // update selection to follow the node
    this.selectedPath = parentPath.concat([target])
  }

  addChild(path, typeKey) {
    const parent = this.getNodeByPath(path)
    if (!parent) return
    if (!parent.children) parent.children = []
    const newNode = {
      id: this.newId(typeKey),
      type: typeKey,
      attrs: {},
      children: [],
    }
    parent.children.push(newNode)
    // select the new node
    this.selectedPath = path.concat([parent.children.length - 1])
  }

  newId(prefix) {
    return `${prefix || 'node'}_${Math.random().toString(36).slice(2, 8)}`
  }

  // ------------- Rendering -------------

  render() {
    const c = this.container
    c.innerHTML = ''
    c.appendChild(this.renderHeader())

    const content = document.createElement('div')
    content.className = 'ms-grid'
    // styling baseline
    const style = document.createElement('style')
    style.textContent = `
      .ms-grid { display: grid; grid-template-columns: 260px 1fr 320px; gap: 16px; }
      .ms-card { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
      .ms-card .hd { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; font-weight: 600; }
      .ms-card .bd { padding: 12px; max-height: 480px; overflow: auto; }
      .ms-row { display: flex; gap: 8px; align-items: center; }
      .ms-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 14px; border: 1px solid #d1d5db; border-radius: 6px; background: #f9fafb; cursor: pointer; }
      .ms-btn::before { content: none !important; display: none !important; }
      .ms-btn:hover { transform: none !important; box-shadow: none !important; }
      .ms-btn.label { background: #e5e7eb; color: #374151; border-color: #d1d5db; font-weight: 600; }
      .ms-btn.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
      .ms-btn.success { background: #059669; color: #fff; border-color: #059669; }
      .ms-btn.warn { background: #f59e0b; color: #fff; border-color: #f59e0b; }
      .ms-input { padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; }
      .ms-select { padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; }
      .ms-tree ul { padding-left: 18px; }
      .ms-tree li { margin: 6px 0; }
      .ms-chip { display:inline-block; padding: 2px 8px; border-radius: 999px; background:#eef2ff; color:#1d4ed8; font-size: 12px; }

      /* Ensure action controls are always visible, not only on hover */
      .ms-tree .ms-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        opacity: 1 !important;
        visibility: visible !important;
      }
      .ms-actions button { margin-right: 6px; }
      .ms-actions .ms-select { min-width: 160px; }

      /* Place the Delete button on its own line under the node controls with a top margin */
      .ms-actions .ms-btn.warn {
        flex-basis: 100%;
        margin-top: 8px;
      }

      .ms-attr-row { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
      .muted { color: #6b7280; }
      .error { color: #b91c1c; padding: 8px 12px; background: #fee2e2; border:1px solid #fecaca; border-radius:6px; margin-bottom:8px; }
      .small { font-size: 12px; }

      /* Force always visible parent row and controls (no hover needed) */
      .ms-tree li .ms-row { opacity: 1 !important; visibility: visible !important; }
      .ms-tree .ms-btn, .ms-tree .ms-select { opacity: 1 !important; visibility: visible !important; }

      /* Compact icon buttons for Up/Down */
      .ms-btn.icon {
        width: 28px;
        height: 28px;
        padding: 0;
        border-radius: 8px;
        display: inline-flex;
        justify-content: center;
        align-items: center;
        font-weight: 600;
        line-height: 1;
      }
    `
    c.appendChild(style)
    // Additional hard overrides so builder controls are always visible and styled (not hidden by global button CSS)
    const style2 = document.createElement('style')
    style2.textContent = `
      /* Ensure parent rows and all controls are always visible and clickable */
      .ms-tree li .ms-row { opacity: 1 !important; visibility: visible !important; }
      .ms-tree .ms-row .ms-btn, .ms-tree .ms-row .ms-select {
        opacity: 1 !important; visibility: visible !important; pointer-events: auto !important;
      }

      /* Neutralize global button effects inside builder */
      .ms-btn {
        background: #f9fafb !important;
        color: #111827 !important;
        border: 1px solid #d1d5db !important;
        box-shadow: none !important;
      }
      .ms-btn::before { content: none !important; display: none !important; }
      .ms-btn:hover { transform: none !important; box-shadow: none !important; }

      /* Label-like look for the node type button */
      .ms-btn.label {
        background: #e5e7eb !important;
        color: #374151 !important;
        border-color: #d1d5db !important;
        font-weight: 600 !important;
      }

      /* Compact icon buttons for Up/Down with clear colors */
      .ms-btn.icon {
        width: 28px !important;
        height: 28px !important;
        padding: 0 !important;
        border-radius: 8px !important;
        display: inline-flex !important;
        justify-content: center !important;
        align-items: center !important;
        font-weight: 700 !important;
        line-height: 1 !important;
        background: #e0e7ff !important;
        color: #1e3a8a !important;
        border-color: #c7d2fe !important;
      }

      /* Header layout + sizing for alignment */
      .ms-header { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .ms-header .ms-btn,
      .ms-header .ms-select,
      .ms-header .ms-input { height: 36px !important; line-height: 1 !important; }

      /* Medium width for Add top-level select and company selector */
      .ms-select.header-select { width: 220px !important; }
      .ms-select.company-select { width: 260px !important; }
    `
    c.appendChild(style2)

    if (this.error) {
      const err = document.createElement('div')
      err.className = 'error'
      err.textContent = this.error
      c.appendChild(err)
    }

    // Left: Palette (Node types + allowed rules)
    const left = document.createElement('div')
    left.className = 'ms-card'
    left.appendChild(this.h('div', 'hd', 'Node Types'))
    const leftBd = document.createElement('div')
    leftBd.className = 'bd'
    if (this.loading) {
      leftBd.appendChild(this.h('div', 'muted', 'Loading...'))
    } else if (!this.structure) {
      leftBd.appendChild(this.h('div', 'muted', 'No structure'))
    } else {
      // Node Types list
      leftBd.appendChild(this.h('div', 'small muted', 'Types'))
      const ulT = document.createElement('ul')
      for (const nt of this.structure.nodeTypes) {
        const li = document.createElement('li')
        li.innerHTML = `<span class="ms-chip">${
          nt.key
        }</span> <span class="muted">- ${nt.label || ''}</span>`
        ulT.appendChild(li)
      }
      leftBd.appendChild(ulT)

      // Flexible ordering: Add child menu hides any type already used as a parent elsewhere
      leftBd.appendChild(
        this.h(
          'div',
          'small muted',
          'Add child only lists node types that are not already a parent anywhere in this tree.'
        )
      )

      // Types Editor toggle and panel
      const btnTypes = this.button(
        this.showTypesEditor ? 'Close Types Editor' : 'Edit Types',
        () => {
          this.showTypesEditor = !this.showTypesEditor
          if (this.showTypesEditor && !this.editingTypeKey) {
            const first =
              (this.structure.nodeTypes &&
                this.structure.nodeTypes[0] &&
                this.structure.nodeTypes[0].key) ||
              ''
            this.editingTypeKey = first
          }
          this.render()
        }
      )
      leftBd.appendChild(btnTypes)
      if (this.showTypesEditor) {
        leftBd.appendChild(this.renderTypesEditor())
      }
    }
    left.appendChild(leftBd)

    // Middle: Tree view
    const mid = document.createElement('div')
    mid.className = 'ms-card'
    mid.appendChild(this.h('div', 'hd', 'Structure'))
    const midBd = document.createElement('div')
    midBd.className = 'bd ms-tree'
    if (this.loading) {
      midBd.appendChild(this.h('div', 'muted', 'Loading tree...'))
    } else if (this.structure) {
      midBd.appendChild(this.renderTree())
    }
    mid.appendChild(midBd)

    // Right: Attributes of selected node
    const right = document.createElement('div')
    right.className = 'ms-card'
    right.appendChild(this.h('div', 'hd', 'Node Attributes'))
    const rightBd = document.createElement('div')
    rightBd.className = 'bd'
    if (!this.structure) {
      rightBd.appendChild(this.h('div', 'muted', 'No data'))
    } else {
      rightBd.appendChild(this.renderAttributePanel())
    }
    right.appendChild(rightBd)

    content.appendChild(left)
    content.appendChild(mid)
    content.appendChild(right)
    c.appendChild(content)
  }

  renderHeader() {
    const wrap = document.createElement('div')
    wrap.className = 'ms-card'
    const hd = this.h('div', 'hd', 'Machine Structure Builder (MVP)')
    const bd = document.createElement('div')
    bd.className = 'bd'

    const row = document.createElement('div')
    row.className = 'ms-row ms-header'
    row.style.opacity = '1'
    row.style.visibility = 'visible'

    // company selector
    const label = this.h('label', 'small muted', 'Company')
    label.style.marginRight = '6px'
    let companyCtl
    if (Array.isArray(this.companies) && this.companies.length) {
      companyCtl = document.createElement('select')
      companyCtl.className = 'ms-select company-select'
      companyCtl.appendChild(new Option('Select company...', ''))
      for (const co of this.companies) {
        companyCtl.appendChild(new Option(co.name, String(co.id)))
      }
      companyCtl.value = this.companyId ? String(this.companyId) : ''
      companyCtl.addEventListener('change', async (e) => {
        const v = parseInt(e.target.value, 10)
        if (!isNaN(v) && v > 0) {
          this.companyId = v
          await this.loadStructure()
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
          await this.loadStructure()
        }
      })
    }

    // load button
    const btnLoad = this.button('Reload', () => this.loadStructure())
    // save button
    const btnSave = this.button(
      this.saving ? 'Saving...' : 'Save',
      () => this.saveStructure(),
      'success'
    )
    const hasToken = !!localStorage.getItem('token')
    btnSave.disabled = this.saving || !this.structure || !hasToken
    if (!hasToken) btnSave.title = 'Login required to save'

    // Run Schema controls (Option A)
    const breakingWrap = document.createElement('label')
    breakingWrap.className = 'small muted'
    breakingWrap.style.marginLeft = '8px'
    const breakingChk = document.createElement('input')
    breakingChk.type = 'checkbox'
    breakingChk.style.marginRight = '4px'
    breakingWrap.appendChild(breakingChk)
    breakingWrap.appendChild(document.createTextNode('Breaking'))

    const btnApply = this.button(
      this.applying ? 'Applying...' : 'Run Schema',
      () => this.applySchema(breakingChk.checked),
      'primary'
    )
    btnApply.disabled = this.applying || !this.structure || !hasToken
    if (!hasToken) btnApply.title = 'Login required to apply'

    // Add top-level child selector
    const selType = document.createElement('select')
    selType.className = 'ms-select header-select'
    const topOptions = this.allowedChildTypeKeys('root').map((k) => ({
      key: k,
      label: this.getTypeDef(k)?.label || k,
    }))
    selType.appendChild(new Option('Add top-level...', ''))
    for (const o of topOptions) selType.appendChild(new Option(o.label, o.key))
    selType.addEventListener('change', (e) => {
      const val = e.target.value
      if (!val) return
      this.addChild([], val)
      this.render()
      e.target.value = ''
    })

    row.appendChild(label)
    row.appendChild(companyCtl)
    row.appendChild(btnLoad)
    row.appendChild(btnSave)
    row.appendChild(breakingWrap)
    row.appendChild(btnApply)
    row.appendChild(this.h('span', 'muted small', ' | '))
    row.appendChild(selType)

    bd.appendChild(row)
    wrap.appendChild(hd)
    wrap.appendChild(bd)
    return wrap
  }

  renderTree() {
    const root = this.structure.tree || {
      id: 'root',
      type: 'root',
      children: [],
    }
    const wrapper = document.createElement('div')
    const ul = document.createElement('ul')
    // Render only children of root as top-level
    root.children.forEach((child, idx) => {
      ul.appendChild(this.renderTreeNode(child, [idx]))
    })
    wrapper.appendChild(ul)
    return wrapper
  }

  renderTreeNode(node, path) {
    const li = document.createElement('li')
    const isSelected = this.isSelected(path)
    const typeDef = this.getTypeDef(node.type)

    // Row with label + actions
    const row = document.createElement('div')
    row.className = 'ms-row'
    const displayKey =
      typeDef && typeDef.displayAttr ? typeDef.displayAttr : 'name'
    const displayVal =
      node.attrs && Object.prototype.hasOwnProperty.call(node.attrs, displayKey)
        ? node.attrs[displayKey]
        : ''
    const title = `${typeDef?.label || node.type}${
      displayVal ? `: ${displayVal}` : ''
    }`
    const btnSel = this.button(
      title,
      () => {
        this.selectedPath = path.slice()
        this.render()
      },
      isSelected ? 'primary' : ''
    )
    btnSel.classList.add('label')
    btnSel.title = 'Select node'
    row.appendChild(btnSel)

    // Actions: reorder, add child, delete
    const actions = document.createElement('div')
    actions.className = 'ms-actions'

    const btnUp = this.button('↑', () => {
      this.moveNode(path, -1)
      this.render()
    })
    btnUp.classList.add('icon')
    const btnDown = this.button('↓', () => {
      this.moveNode(path, +1)
      this.render()
    })
    btnDown.classList.add('icon')
    actions.appendChild(btnUp)
    actions.appendChild(btnDown)

    // Add child selector for allowed types
    const allowed = this.allowedChildTypeKeys(node.type)
    if (allowed.length > 0) {
      const sel = document.createElement('select')
      sel.className = 'ms-select'
      sel.appendChild(new Option('Add child...', ''))
      for (const t of allowed) {
        const td = this.getTypeDef(t)
        sel.appendChild(new Option(td?.label || t, t))
      }
      sel.addEventListener('change', (e) => {
        const val = e.target.value
        if (!val) return
        this.addChild(path, val)
        this.render()
      })
      actions.appendChild(sel)
    }

    const btnDel = this.button(
      'Delete',
      () => {
        this.removeNodeByPath(path)
        // Reset selection if deleted selected
        if (this.pathsEqual(path, this.selectedPath)) {
          this.selectedPath = []
        }
        this.render()
      },
      'warn'
    )
    actions.appendChild(btnDel)

    row.appendChild(actions)
    li.appendChild(row)

    // Render children recursively
    if (Array.isArray(node.children) && node.children.length > 0) {
      const ul = document.createElement('ul')
      node.children.forEach((ch, i) => {
        ul.appendChild(this.renderTreeNode(ch, path.concat([i])))
      })
      li.appendChild(ul)
    }

    return li
  }

  renderAttributePanel() {
    const wrap = document.createElement('div')
    const node = this.getNodeByPath(this.selectedPath)
    if (!node || node.type === 'root') {
      wrap.appendChild(
        this.h('div', 'muted', 'Select a node to edit its attributes')
      )
      return wrap
    }
    const def = this.getTypeDef(node.type)
    const attrs = def && Array.isArray(def.attributes) ? def.attributes : []
    const form = document.createElement('div')

    // Show node meta
    form.appendChild(
      this.h(
        'div',
        'small muted',
        `Node ID: ${node.id || '(none)'} | Type: ${node.type}`
      )
    )

    // Generate inputs from attribute defs
    for (const a of attrs) {
      const row = document.createElement('div')
      row.className = 'ms-attr-row'
      const label = this.h('label', 'small', a.label || a.key)
      label.style.width = '110px'
      row.appendChild(label)

      const value = node.attrs?.[a.key]
      let input
      switch (a.type) {
        case 'integer':
          input = document.createElement('input')
          input.type = 'number'
          input.step = '1'
          input.value = Number.isInteger(value) ? String(value) : ''
          break
        case 'number':
          input = document.createElement('input')
          input.type = 'number'
          input.value = typeof value === 'number' ? String(value) : ''
          break
        case 'boolean':
          input = document.createElement('select')
          input.appendChild(new Option('false', 'false'))
          input.appendChild(new Option('true', 'true'))
          input.value = value === true ? 'true' : 'false'
          break
        case 'date':
          input = document.createElement('input')
          input.type = 'date'
          input.value = typeof value === 'string' ? value : ''
          break
        default:
          input = document.createElement('input')
          input.type = 'text'
          input.value =
            typeof value === 'string'
              ? value
              : value == null
              ? ''
              : String(value)
          break
      }
      input.className = 'ms-input'
      input.style.flex = '1'
      input.addEventListener('input', (e) => {
        this.updateAttr(this.selectedPath, a, e.target.value)
      })
      row.appendChild(input)

      if (a.required) {
        row.appendChild(this.h('span', 'small muted', '(required)'))
      }

      form.appendChild(row)
    }

    wrap.appendChild(form)
    return wrap
  }

  updateAttr(path, attrDef, rawVal) {
    const node = this.getNodeByPath(path)
    if (!node) return
    if (!node.attrs) node.attrs = {}
    let v = rawVal
    switch (attrDef.type) {
      case 'integer': {
        const n = parseInt(rawVal, 10)
        v = isNaN(n) ? null : n
        break
      }
      case 'number': {
        const n = parseFloat(rawVal)
        v = isNaN(n) ? null : n
        break
      }
      case 'boolean':
        v = String(rawVal) === 'true'
        break
      case 'date':
        v = rawVal // assume yyyy-mm-dd
        break
      default:
        v = rawVal
    }
    node.attrs[attrDef.key] = v
  }

  // Client-side validation helpers
  typeMatches(v, t) {
    switch (t) {
      case 'string':
        return typeof v === 'string'
      case 'integer':
        return Number.isInteger(v)
      case 'number':
        return typeof v === 'number' && !Number.isNaN(v)
      case 'boolean':
        return typeof v === 'boolean'
      case 'date':
        return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
      case 'json':
        return v !== null && typeof v === 'object'
      default:
        return true
    }
  }

  validateClient() {
    const errs = []
    const types = {}
    const nts =
      this.structure && Array.isArray(this.structure.nodeTypes)
        ? this.structure.nodeTypes
        : []
    for (const t of nts) {
      if (t && t.key) types[t.key] = t
    }

    const checkNode = (node, pathStr) => {
      if (!node) return
      if (node.type === 'root') {
        const children = Array.isArray(node.children) ? node.children : []
        children.forEach((ch, i) => checkNode(ch, `root[${i}]`))
        return
      }
      const def = types[node.type]
      if (!def) {
        errs.push(`Unknown type at ${pathStr}: ${node.type}`)
      } else {
        const defs = Array.isArray(def.attributes) ? def.attributes : []
        // Required presence
        for (const a of defs) {
          if (a && a.required) {
            const has =
              node.attrs &&
              Object.prototype.hasOwnProperty.call(node.attrs, a.key)
            const val = has ? node.attrs[a.key] : undefined
            if (
              !has ||
              val === '' ||
              val === null ||
              typeof val === 'undefined'
            ) {
              errs.push(`Missing required '${a.key}' at ${pathStr}`)
            }
          }
        }
        // Type checks
        for (const a of defs) {
          if (!a || !a.key) continue
          if (
            node.attrs &&
            Object.prototype.hasOwnProperty.call(node.attrs, a.key)
          ) {
            const val = node.attrs[a.key]
            const t = a.type || 'string'
            if (!this.typeMatches(val, t)) {
              errs.push(
                `Wrong type for '${a.key}' at ${pathStr}, expected ${t}`
              )
            }
          }
        }
      }
      // Recurse
      const children = Array.isArray(node.children) ? node.children : []
      children.forEach((ch, i) => checkNode(ch, `${pathStr}.children[${i}]`))
    }

    checkNode(this.structure ? this.structure.tree : null, 'root')
    return errs
  }

  // --------- Types Editor (Schema Designer) ---------
  renderTypesEditor() {
    const wrap = document.createElement('div')
    wrap.style.marginTop = '10px'
    wrap.style.padding = '10px'
    wrap.style.border = '1px solid #eef2f7'
    wrap.style.borderRadius = '8px'
    wrap.style.background = '#fafafa'

    if (!this.structure) {
      wrap.appendChild(this.h('div', 'muted small', 'No structure'))
      return wrap
    }

    const types = Array.isArray(this.structure.nodeTypes)
      ? this.structure.nodeTypes
      : []
    if (!types.length) {
      wrap.appendChild(this.h('div', 'muted small', 'No node types'))
      return wrap
    }

    // Type selector
    const rowSel = document.createElement('div')
    rowSel.className = 'ms-row'
    rowSel.style.marginBottom = '8px'
    const lbl = this.h('label', 'small muted', 'Type')
    const sel = document.createElement('select')
    sel.className = 'ms-select'
    for (const t of types) sel.appendChild(new Option(t.label || t.key, t.key))
    if (!this.editingTypeKey) this.editingTypeKey = types[0].key
    sel.value = this.editingTypeKey
    sel.addEventListener('change', (e) => {
      this.editingTypeKey = e.target.value
      this.render()
    })
    rowSel.appendChild(lbl)
    rowSel.appendChild(sel)
    wrap.appendChild(rowSel)

    const typeDef = this.getTypeDef(this.editingTypeKey) || {
      key: this.editingTypeKey,
      attributes: [],
    }
    if (!Array.isArray(typeDef.attributes)) typeDef.attributes = []

    // Display attribute row (used as the tree label)
    const rowDisp = document.createElement('div')
    rowDisp.className = 'ms-row'
    rowDisp.style.marginBottom = '8px'
    const lblDisp = this.h('label', 'small muted', 'Display attribute')
    const selDisp = document.createElement('select')
    selDisp.className = 'ms-select'
    const attrKeys = [
      'name',
      ...typeDef.attributes.map((a) => a.key).filter(Boolean),
    ]
    const seen = new Set()
    for (const k of attrKeys) {
      if (!k || seen.has(k)) continue
      seen.add(k)
      selDisp.appendChild(new Option(k, k))
    }
    selDisp.value = typeDef.displayAttr || 'name'
    selDisp.addEventListener('change', (e) => {
      typeDef.displayAttr = e.target.value || 'name'
      this.render() // update labels in the tree
    })
    rowDisp.appendChild(lblDisp)
    rowDisp.appendChild(selDisp)
    wrap.appendChild(rowDisp)

    // Attributes list
    wrap.appendChild(this.h('div', 'small muted', 'Attributes'))
    const list = document.createElement('div')
    list.style.display = 'flex'
    list.style.flexDirection = 'column'
    list.style.gap = '6px'

    const makeAttrRow = (a, idx) => {
      const row = document.createElement('div')
      row.className = 'ms-row'
      row.style.alignItems = 'flex-start'
      row.style.flexWrap = 'wrap'

      // key
      const inpKey = document.createElement('input')
      inpKey.className = 'ms-input'
      inpKey.placeholder = 'key'
      inpKey.style.width = '120px'
      inpKey.value = a.key || ''
      inpKey.addEventListener('input', (e) => {
        a.key = e.target.value.trim()
      })

      // label
      const inpLabel = document.createElement('input')
      inpLabel.className = 'ms-input'
      inpLabel.placeholder = 'label'
      inpLabel.style.width = '120px'
      inpLabel.value = a.label || ''
      inpLabel.addEventListener('input', (e) => {
        a.label = e.target.value
      })

      // type
      const selType = document.createElement('select')
      selType.className = 'ms-select'
      ;[
        'string',
        'integer',
        'number',
        'boolean',
        'date',
        'json',
        'enum',
      ].forEach((t) => selType.appendChild(new Option(t, t)))
      selType.value = a.type || 'string'
      selType.addEventListener('change', (e) => {
        a.type = e.target.value
        this.render() // show/hide enum editor as needed
      })

      // required
      const chkReqWrap = this.h('label', 'small muted', 'required')
      chkReqWrap.style.display = 'inline-flex'
      chkReqWrap.style.alignItems = 'center'
      chkReqWrap.style.gap = '4px'
      const chkReq = document.createElement('input')
      chkReq.type = 'checkbox'
      chkReq.checked = !!a.required
      chkReq.addEventListener('change', (e) => {
        a.required = !!e.target.checked
      })
      chkReqWrap.prepend(chkReq)

      // enum values editor (comma separated)
      let enumInput = null
      if ((a.type || 'string') === 'enum') {
        enumInput = document.createElement('input')
        enumInput.className = 'ms-input'
        enumInput.placeholder = 'enum values (comma-separated)'
        enumInput.style.width = '220px'
        const vals = Array.isArray(a.values) ? a.values : []
        enumInput.value = vals.join(', ')
        enumInput.addEventListener('input', (e) => {
          const raw = e.target.value
          a.values = raw
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        })
      }

      const btnDel = this.button('Remove', () => {
        typeDef.attributes.splice(idx, 1)
        // if displayAttr points to removed key, fallback to 'name'
        const disp = typeDef.displayAttr || 'name'
        if (disp && disp !== 'name') {
          const stillExists = typeDef.attributes.some((x) => x.key === disp)
          if (!stillExists) typeDef.displayAttr = 'name'
        }
        this.render()
      })

      row.appendChild(inpKey)
      row.appendChild(inpLabel)
      row.appendChild(selType)
      row.appendChild(chkReqWrap)
      if (enumInput) row.appendChild(enumInput)
      row.appendChild(btnDel)
      return row
    }

    typeDef.attributes.forEach((a, idx) => {
      list.appendChild(makeAttrRow(a, idx))
    })
    wrap.appendChild(list)

    const btnAdd = this.button(
      'Add attribute',
      () => {
        typeDef.attributes.push({
          key: '',
          label: '',
          type: 'string',
          required: false,
        })
        this.render()
      },
      'success'
    )
    btnAdd.style.marginTop = '8px'
    wrap.appendChild(btnAdd)

    // Help/explanation
    const help = document.createElement('div')
    help.className = 'small muted'
    help.style.marginTop = '8px'
    help.innerHTML =
      'The “display attribute” controls the label shown in the tree (defaults to name). ' +
      'Attributes defined here become physical columns when you Run Schema. ' +
      'We keep “name” by default because indexes/uniqueness commonly reference it; ' +
      'you can still add more fields (code, description, etc.) as needed.'
    wrap.appendChild(help)

    return wrap
  }
  // ------------- Utils -------------

  isSelected(path) {
    return this.pathsEqual(path, this.selectedPath)
  }

  pathsEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  h(tag, className, text) {
    const el = document.createElement(tag)
    if (className) el.className = className
    if (text != null) el.textContent = text
    return el
  }

  button(label, onClick, variant = '') {
    const btn = document.createElement('button')
    btn.type = 'button'

    btn.className = 'ms-btn' + (variant ? ` ${variant}` : '')
    btn.textContent = label
    btn.addEventListener('click', onClick)
    return btn
  }

  attachGlobalHandlers() {
    // no-op for MVP
  }
}

// Expose globally for app.js componentMap registration
window.MachineStruture = MachineStruture
