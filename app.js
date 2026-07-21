// ══════════════════════════════════════════════════════════════════
//  CONFIG & UTILS
// ══════════════════════════════════════════════════════════════════
const API_URL = 'http://127.0.0.1:5000/api';

let SCHEMES = [];
let trackedApps = [];
let formData = { crops: [] };
let activeAppPanelTab = 'not_filled';

const TIMELINE_STAGES = ['Visited', 'Applied', 'Under Review', 'Approved / Disbursed'];

// Local Session Helpers
const getToken = () => localStorage.getItem('mfp_token');
const getRole = () => localStorage.getItem('mfp_role');
const getUserId = () => localStorage.getItem('mfp_user_id');

function saveSession(token, userId, role, farmer = null) {
  localStorage.setItem('mfp_token', token);
  localStorage.setItem('mfp_user_id', userId);
  localStorage.setItem('mfp_role', role);
  if (farmer) {
    localStorage.setItem('mfp_farmer', JSON.stringify(farmer));
  } else {
    localStorage.removeItem('mfp_farmer');
  }
}

function getSavedFarmer() {
  try {
    return JSON.parse(localStorage.getItem('mfp_farmer') || 'null');
  } catch {
    return null;
  }
}

// Global API Fetch Helper
async function apiCall(endpoint, method = 'GET', body = null, isAuthRequired = true) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (isAuthRequired) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const config = {
    method,
    headers
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(`${API_URL}${endpoint}`, config);
    const data = await res.json();
    
    if (res.status === 401) {
      // Token failed or expired
      showToast('Session expired. Please login again.', 'error');
      handleLogout();
      return null;
    }
    
    return data;
  } catch (error) {
    console.error(`API Call to ${endpoint} failed:`, error);
    showToast('Network error, please check if backend is running', 'error');
    return null;
  }
}

// ── Cookie helpers (retained for return check cookies) ─────────────
function setCookie(name, value, days = 365) {
  const d = new Date();
  d.setTime(d.getTime() + days * 86400000);
  document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};expires=${d.toUTCString()};path=/;SameSite=Lax`;
}

function getCookie(name) {
  const v = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  if (!v) return null;
  try {
    return JSON.parse(decodeURIComponent(v.split('=').slice(1).join('=')));
  } catch {
    return null;
  }
}

function deleteCookie(name) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
}

// ══════════════════════════════════════════════════════════════════
//  SCHEME OPERATIONS (GET PUBLIC)
// ══════════════════════════════════════════════════════════════════
async function fetchSchemes() {
  const data = await apiCall('/schemes', 'GET', null, false);
  if (data && data.success) {
    SCHEMES = data.schemes;
  }
}

// ══════════════════════════════════════════════════════════════════
//  APPLICATION TRACKER APIs
// ══════════════════════════════════════════════════════════════════
async function fetchFarmerApplications() {
  const data = await apiCall('/farmer/applications', 'GET');
  if (data && data.success) {
    trackedApps = data.applications;
  } else {
    trackedApps = [];
  }
  updateNotifBadge();
}

async function trackApplication(schemeId, schemeName, applyUrl, stage = 'visited') {
  const scheme = SCHEMES.find(s => s.id === schemeId);
  const ts = new Date().toISOString();
  
  let stageIndex = 0;
  if (stage === 'applied') stageIndex = 1;
  else if (stage === 'under_review') stageIndex = 2;
  else if (stage === 'approved_disbursed') stageIndex = 3;

  const body = {
    schemeId,
    schemeName,
    ministry: scheme?.ministry || '',
    icon: scheme?.icon || '📋',
    applyUrl,
    status: stage,
    stageIndex,
    notes: stage === 'visited' 
      ? `Visited official portal on ${new Date().toLocaleDateString('en-IN')}` 
      : `Applied on official portal on ${new Date().toLocaleDateString('en-IN')}`
  };

  const data = await apiCall('/farmer/applications', 'POST', body);
  if (data && data.success) {
    showToast(stage === 'visited'
      ? `📌 "${schemeName}" — Tracked! Fill the form on the official portal & mark as Applied.`
      : `✅ "${schemeName}" marked as Applied!`,
      stage === 'applied' ? 'success' : 'info');
    
    await fetchFarmerApplications();
    renderSchemesGridStatus();
  }
}

async function markApplied(schemeId) {
  const scheme = SCHEMES.find(s => s.id === schemeId);
  await trackApplication(schemeId, scheme?.name || '', scheme?.applyUrl || '', 'applied');
  renderAppPanel();
}

async function advanceStatus(schemeId) {
  const app = trackedApps.find(a => a.schemeId === schemeId);
  if (!app) return;
  
  if (app.stageIndex < TIMELINE_STAGES.length - 1) {
    const nextIndex = app.stageIndex + 1;
    const statuses = ['visited', 'applied', 'under_review', 'approved_disbursed'];
    const nextStatus = statuses[nextIndex];
    
    const body = {
      schemeId,
      status: nextStatus,
      stageIndex: nextIndex,
      notes: `${app.notes || ''} | Status updated: ${TIMELINE_STAGES[nextIndex]} on ${new Date().toLocaleDateString('en-IN')}`
    };
    
    const data = await apiCall('/farmer/applications', 'POST', body);
    if (data && data.success) {
      showToast(`📊 Status updated to "${TIMELINE_STAGES[nextIndex]}"`, 'success');
      await fetchFarmerApplications();
      renderAppPanel();
      updateDashboard();
    }
  }
}

async function removeApp(schemeId) {
  const data = await apiCall(`/farmer/applications/${schemeId}`, 'DELETE');
  if (data && data.success) {
    showToast('Removed from tracker.', 'info');
    await fetchFarmerApplications();
    renderAppPanel();
    renderSchemesGridStatus();
    updateDashboard();
  }
}

function handleApplyClick(schemeId, schemeName, applyUrl) {
  if (!getToken()) {
    showToast('Please login or register to check eligibility and track applications.', 'warning');
    showLogin();
    return;
  }

  // 1. Track visit immediately in backend
  trackApplication(schemeId, schemeName, applyUrl, 'visited');

  // 2. Store pending visit in cookie so we can detect return
  const pending = getCookie('mfp_pending_visit') || [];
  if (!pending.find(p => p.id === schemeId)) {
    pending.push({ id: schemeId, name: schemeName, url: applyUrl, ts: Date.now() });
    setCookie('mfp_pending_visit', pending, 1);
  }

  // 3. Set a "return check" cookie for this specific scheme
  setCookie(`mfp_scheme_${schemeId}_visit`, { ts: Date.now(), url: applyUrl, name: schemeName }, 7);

  // 4. Open official portal in new tab
  window.open(applyUrl, '_blank');

  // 5. Visibility change listeners
  document.addEventListener('visibilitychange', function onVis() {
    if (document.visibilityState === 'visible') {
      document.removeEventListener('visibilitychange', onVis);
      setTimeout(() => handleReturnFromOfficialSite(schemeId, schemeName, applyUrl), 800);
    }
  }, { once: true });
}

function handleReturnFromOfficialSite(schemeId, schemeName, applyUrl) {
  const existing = trackedApps.find(a => a.schemeId === schemeId);
  if (!existing || existing.status !== 'visited') return;
  showReturnPrompt(schemeId, schemeName, applyUrl);
}

function showReturnPrompt(schemeId, schemeName, applyUrl) {
  const banner = document.getElementById('returnBanner');
  document.getElementById('returnBannerTitle').textContent = `Did you apply for ${schemeName.split(' ').slice(0, 4).join(' ')}...?`;
  document.getElementById('returnBannerMsg').textContent = 'You just visited the official portal. Mark your application status!';

  banner.classList.add('show');
  banner.dataset.schemeId = schemeId;
  banner.dataset.schemeName = schemeName;
  banner.dataset.applyUrl = applyUrl;

  const btn = banner.querySelector('.rb-btn-primary');
  btn.textContent = '✅ Yes, I Applied!';
  btn.onclick = async () => {
    await trackApplication(schemeId, schemeName, applyUrl, 'applied');
    dismissReturnBanner();
    openAppPanel();
  };

  setTimeout(dismissReturnBanner, 15000);
}

function dismissReturnBanner() {
  document.getElementById('returnBanner').classList.remove('show');
}

function checkPendingVisitsOnLoad() {
  const pending = getCookie('mfp_pending_visit') || [];
  const recentPending = pending.filter(p => Date.now() - p.ts < 30 * 60 * 1000); // within 30 min

  if (recentPending.length === 0) return;

  const farmer = getSavedFarmer();
  if (!farmer) return;

  const latest = recentPending[recentPending.length - 1];
  const existing = trackedApps.find(a => a.schemeId === latest.id);

  if (!existing || existing.status === 'visited') {
    setTimeout(() => {
      document.getElementById('returnBannerTitle').textContent = `Welcome back, ${farmer.name}!`;
      document.getElementById('returnBannerMsg').textContent = `You visited ${latest.name}. Did you complete the application?`;

      const banner = document.getElementById('returnBanner');
      banner.classList.add('show');

      const btn = banner.querySelector('.rb-btn-primary');
      btn.textContent = '📋 Update Status';
      btn.onclick = () => {
        openAppPanel();
        dismissReturnBanner();
      };
    }, 1500);
  }
}

function updateNotifBadge() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (trackedApps.length > 0) {
    badge.style.display = 'flex';
    badge.textContent = trackedApps.length;
  } else {
    badge.style.display = 'none';
  }
}

function renderSchemesGridStatus() {
  trackedApps.forEach(app => {
    const chipEl = document.getElementById(`chip-${app.schemeId}`);
    if (!chipEl) return;
    const stage = TIMELINE_STAGES[app.stageIndex] || 'Visited';
    const cls = app.stageIndex >= 1 ? 'applied' : 'visited';
    chipEl.style.display = 'inline-flex';
    chipEl.className = `app-status-chip ${cls}`;
    
    let stageKey = 'stage_' + stage.toLowerCase().replace(/ \/ /g, '_').replace(/ /g, '_');
    let stageTrans = t(stageKey);
    if (stageTrans === stageKey) stageTrans = stage;
    
    chipEl.textContent = app.stageIndex === 0 
      ? (t('visited_status') || '👁 Visited Portal') 
      : app.stageIndex === 1 
        ? (t('applied_status') || '📝 Applied') 
        : '✅ ' + stageTrans;
  });
}

// ══════════════════════════════════════════════════════════════════
//  APP PANEL RENDER
// ══════════════════════════════════════════════════════════════════
function renderAppPanel() {
  const statsEl = document.getElementById('appStats');
  const listEl = document.getElementById('appListContainer');

  const visited = trackedApps.filter(a => a.stageIndex === 0).length;
  const applied = trackedApps.filter(a => a.stageIndex >= 1).length;
  const approved = trackedApps.filter(a => a.stageIndex >= 3).length;
  
  statsEl.innerHTML = `
    <div class="app-stat"><div class="asn">${trackedApps.length}</div><div class="asl">${t('total_tracked') || 'Total Tracked'}</div></div>
    <div class="app-stat"><div class="asn" style="color:var(--saffron)">${applied}</div><div class="asl">${t('stage_applied') || 'Applied'}</div></div>
    <div class="app-stat"><div class="asn" style="color:#1565c0">${approved}</div><div class="asl">${t('stage_approved_disbursed') || 'Approved'}</div></div>
  `;

  // Filter tracked applications based on active tab
  const filteredApps = activeAppPanelTab === 'not_filled'
    ? trackedApps.filter(a => a.stageIndex === 0)
    : trackedApps.filter(a => a.stageIndex >= 1);

  if (filteredApps.length === 0) {
    if (activeAppPanelTab === 'not_filled') {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📝</div>
          <h3>${t('no_pending_apps_title') || 'No Pending Applications'}</h3>
          <p>${t('no_pending_apps_desc') || "All your tracked schemes have been applied for, or you haven't visited any scheme portal yet."}</p>
        </div>`;
    } else {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⏳</div>
          <h3>${t('no_applied_schemes_title') || 'No Applied Schemes'}</h3>
          <p>${t('no_applied_schemes_desc') || 'You haven\'t marked any scheme as applied yet. Click "I Applied" on any visited scheme to start tracking progress.'}</p>
        </div>`;
    }
    return;
  }

  listEl.innerHTML = filteredApps.map(app => {
    const stage = app.stageIndex || 0;
    const sName = tScheme(app.schemeId, 'name', app.schemeName);
    const sMinistry = tScheme(app.schemeId, 'ministry', app.ministry);
    return `
    <div class="app-item">
      <div class="app-item-head">
        <div class="app-item-icon">${app.icon || '🌾'}</div>
        <div>
          <div class="app-item-name">${sName}</div>
          <div class="app-item-ministry">${sMinistry || ''}</div>
        </div>
      </div>

      <div class="app-timeline">
        ${TIMELINE_STAGES.map((s, i) => {
          let stageKey = 'stage_' + s.toLowerCase().replace(/ \/ /g, '_').replace(/ /g, '_');
          let stageTrans = t(stageKey);
          if (stageTrans === stageKey) stageTrans = s.split(' ')[0];
          return `
          <div class="tl-step ${i < stage ? 'done' : i === stage ? 'active' : ''}">
            <div class="tl-dot">${i < stage ? '✓' : i + 1}</div>
            <div class="tl-lbl">${stageTrans}</div>
          </div>`;
        }).join('')}
      </div>

      <div class="app-item-meta">
        <div>
          <div class="app-item-date">${t('tracked_label') || '📅 Tracked'}: ${new Date(app.visitedAt || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
        </div>
        <span class="status-pill ${stage === 0 ? 'pill-visited' : 'pill-applied'}">
          ${t('stage_' + TIMELINE_STAGES[stage].toLowerCase().replace(/ \/ /g, '_').replace(/ /g, '_')) || TIMELINE_STAGES[stage]}
        </span>
      </div>

      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        ${stage === 0 ? `<button class="app-update-btn" style="flex:1" onclick="markApplied(${app.schemeId})">${t('i_applied_btn') || '✅ I Applied on the Portal'}</button>` : ''}
        ${stage > 0 && stage < TIMELINE_STAGES.length - 1 ? `<button class="app-update-btn" style="flex:1" onclick="advanceStatus(${app.schemeId})">${t('advance_to_btn') || '⬆️ Advance to'}: ${t('stage_' + TIMELINE_STAGES[stage + 1].toLowerCase().replace(/ \/ /g, '_').replace(/ /g, '_')) || TIMELINE_STAGES[stage + 1]}</button>` : ''}
        <a href="${app.applyUrl}" target="_blank" class="btn-green" style="padding:10px 14px;font-size:12px" onclick="handleApplyClick(${app.schemeId}, '${app.schemeName.replace(/'/g, "\\'")}', '${app.applyUrl}')">${t('visit_portal_btn') || '🔗 Visit Portal'}</a>
        <button onclick="removeApp(${app.schemeId})" style="padding:10px 12px;background:none;border:1px solid #e0d5c5;border-radius:9px;font-size:12px;cursor:pointer;color:#999;font-family:'DM Sans',sans-serif" title="${t('remove_btn') || 'Remove'}">🗑</button>
      </div>

      ${app.notes ? `<div style="margin-top:8px;font-size:11px;color:var(--muted);background:var(--cream);border-radius:8px;padding:8px 10px">📝 ${app.notes}</div>` : ''}
    </div>`;
  }).join('');
}

function setAppPanelTab(tab) {
  activeAppPanelTab = tab;
  document.getElementById('btnAppTabNotFilled').classList.toggle('active', tab === 'not_filled');
  document.getElementById('btnAppTabApplied').classList.toggle('active', tab === 'applied');
  renderAppPanel();
}

function openAppPanel() {
  if (!getToken()) {
    showToast('Please login to track your applications.', 'warning');
    showLogin();
    return;
  }
  renderAppPanel();
  document.getElementById('appPanelOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeAppPanel(e) {
  if (e.target === document.getElementById('appPanelOverlay')) closeAppPanelBtn();
}

function closeAppPanelBtn() {
  document.getElementById('appPanelOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

// ══════════════════════════════════════════════════════════════════
//  ADVANCED SEARCH & FILTERING
// ══════════════════════════════════════════════════════════════════
let currentFilter = 'all';

function searchSchemes() {
  const query = document.getElementById('schemeSearchInput').value.toLowerCase().trim();
  const benefitFilter = document.getElementById('benefitFilter').value;
  
  if (!query && !benefitFilter) {
    renderSchemeCards(currentFilter);
    document.getElementById('searchResults').textContent = '';
    return;
  }
  
  const searchResults = SCHEMES.filter(scheme => {
    const matchesSearch = !query || 
      scheme.name.toLowerCase().includes(query) ||
      scheme.ministry.toLowerCase().includes(query) ||
      scheme.description.toLowerCase().includes(query) ||
      scheme.tags.some(tag => tag.includes(query));
    
    const matchesBenefit = !benefitFilter || 
      scheme.type.toLowerCase().includes(benefitFilter) ||
      scheme.benefit.toLowerCase().includes(benefitFilter);
    
    return matchesSearch && matchesBenefit;
  });
  
  renderSchemeGrid(searchResults);
  document.getElementById('searchResults').textContent = `Found ${searchResults.length} matching schemes`;
}

function resetSearch() {
  document.getElementById('schemeSearchInput').value = '';
  document.getElementById('benefitFilter').value = '';
  document.getElementById('searchResults').textContent = '';
  renderSchemeCards(currentFilter);
}

function renderSchemeGrid(schemes) {
  const grid = document.getElementById('schemesGrid');
  
  grid.innerHTML = schemes.map(s => {
    const isCentral = s.tags.includes('central');
    const appEntry = trackedApps.find(a => a.schemeId === s.id);
    
    // Caste labels translation
    let catLabel = s.eligibility.category;
    if (s.eligibility.category === 'all') {
      catLabel = t('search_all_categories') || 'All Categories';
    } else if (s.eligibility.category === 'SC only') {
      catLabel = '🔵 ' + (t('sc_only_label') || 'SC Only');
    } else if (s.eligibility.category === 'ST only') {
      catLabel = '🏹 ' + (t('st_only_label') || 'ST Only');
    }

    const sName = tScheme(s.id, 'name', s.name);
    const sMinistry = tScheme(s.id, 'ministry', s.ministry);
    const sDesc = tScheme(s.id, 'description', s.description);
    const sBenefit = tScheme(s.id, 'benefit', s.benefit);

    return `
    <div class="scheme-card">
      <div class="sc-head">
        <div class="sc-icon ${s.iconClass || 'g'}">${s.icon || '🌾'}</div>
        <div class="sc-title">
          <h3>${sName} <span class="${isCentral ? 'chip-central' : 'chip-state'}">${isCentral ? t('chip_central') || 'Central' : t('chip_state') || 'Maharashtra'}</span></h3>
          <div class="ministry">${sMinistry}</div>
          <span class="app-status-chip ${appEntry ? (appEntry.stageIndex >= 1 ? 'applied' : 'visited') : ''}" id="chip-${s.id}" style="display:${appEntry ? 'inline-flex' : 'none'}">
            ${appEntry ? (appEntry.stageIndex >= 1 ? t('applied_status') || '📝 Applied' : t('visited_status') || '👁 Visited Portal') : ''}
          </span>
        </div>
      </div>
      <div class="sc-body">
        <p>${sDesc.substring(0, 115)}...</p>
        <div class="chips">
          <span class="chip chip-g">💰 ${Array.isArray(s.eligibility.income) ? t('income_limited') || 'Income: Limited' : t('income_all') || 'All income'}</span>
          <span class="chip chip-o">🌾 ${Array.isArray(s.eligibility.land) ? t('land_specific') || 'Specific land' : t('land_all') || 'All sizes'}</span>
          <span class="chip chip-b">👤 ${catLabel}</span>
        </div>
      </div>
      <div class="sc-foot">
        <span class="sc-benefit">🎯 ${sBenefit}</span>
        <button class="btn-green" onclick="handleApplyClick(${s.id}, '${s.name.replace(/'/g, "\\'")}', '${s.applyUrl}')">
          ${appEntry ? t('visit_again') || '🔗 Visit Again' : t('apply_btn') || 'Apply →'}
        </button>
      </div>
    </div>`;
  }).join('');
}

function renderSchemeCards(filter = 'all') {
  currentFilter = filter;
  const filtered = filter === 'all' ? SCHEMES : SCHEMES.filter(s => s.tags.includes(filter));
  
  const badge = document.getElementById('schemeCountBadge');
  if (badge) badge.textContent = filtered.length;

  renderSchemeGrid(filtered);
  renderSchemesGridStatus();
}

function filterSchemes(type, btn) {
  currentFilter = type;
  document.querySelectorAll('.filter-bar .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderSchemeCards(type);
}

// ══════════════════════════════════════════════════════════════════
//  DASHBOARD FUNCTIONS
// ══════════════════════════════════════════════════════════════════
async function updateDashboard() {
  const farmer = getSavedFarmer();
  if (!farmer) return;
  
  document.getElementById('dashFarmerName').textContent = farmer.name || 'Farmer';
  document.getElementById('dashFarmerLocation').textContent = `Location: ${farmer.state || 'Maharashtra'} / ${farmer.district || '—'}`;
  
  const incomeStr = farmer.income || '';
  document.getElementById('dashIncome').textContent = `Income: ₹${incomeStr.replace(/-/g, ' - ₹')}`;
  document.getElementById('dashLand').textContent = `Land: ${farmer.land || '—'} acres (${farmer.landType || '—'})`;
  document.getElementById('dashCategory').textContent = `Category: ${farmer.category || '—'}`;
  
  // Show spinner for eligible schemes loader
  const spinner = document.getElementById('dashEligibleSpinner');
  const errorDiv = document.getElementById('dashEligibleError');
  const grid = document.getElementById('dashEligibleGrid');
  
  if (spinner) spinner.style.display = 'block';
  if (errorDiv) errorDiv.style.display = 'none';
  if (grid) grid.innerHTML = '';

  // Fetch eligible schemes dynamically from backend API
  let matched = [];
  const apiRes = await apiCall('/schemes/eligible', 'GET');
  
  if (spinner) spinner.style.display = 'none';

  if (apiRes && apiRes.success) {
    matched = apiRes.schemes;
  } else {
    // Fallback to client-side matching if backend call failed
    console.warn('Fallback to client-side scheme matching.');
    matched = matchSchemes(farmer);
    if (errorDiv) {
      errorDiv.textContent = 'Could not sync with server. Showing client-side matching results.';
      errorDiv.style.display = 'block';
    }
  }
  
  const applied = trackedApps.filter(a => a.stageIndex >= 1).length;
  const totalBenefit = matched.reduce((sum, scheme) => sum + (scheme.maxBenefit || 0), 0);
  
  document.getElementById('eligibleSchemesCount').textContent = matched.length;
  document.getElementById('appliedCount').textContent = applied;
  document.getElementById('totalBenefit').textContent = `₹${totalBenefit.toLocaleString('en-IN')}`;
  
  // Render Eligible Schemes in the Dashboard Grid
  renderDashboardEligibleSchemes(matched);
  
  // Render Tracked Applications in the Dashboard List
  renderDashboardTrackedApplications();
}

function renderDashboardEligibleSchemes(schemes) {
  const grid = document.getElementById('dashEligibleGrid');
  if (!grid) return;

  if (schemes.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: span 3; text-align:center; padding:32px; color:var(--muted)">
        <div style="font-size:48px; margin-bottom:12px">🎯</div>
        <p data-i18n="dash_no_eligible">No eligible schemes found for your current profile. Update your farm or income details to check again!</p>
      </div>`;
    return;
  }

  grid.innerHTML = schemes.slice(0, 6).map(s => {
    const isCentral = s.tags.includes('central');
    const appEntry = trackedApps.find(a => a.schemeId === s.id);
    
    // Caste labels translation
    let catLabel = s.eligibility.category;
    if (s.eligibility.category === 'all') {
      catLabel = t('search_all_categories') || 'All Categories';
    } else if (s.eligibility.category === 'SC only') {
      catLabel = '🔵 ' + (t('sc_only_label') || 'SC Only');
    } else if (s.eligibility.category === 'ST only') {
      catLabel = '🏹 ' + (t('st_only_label') || 'ST Only');
    }

    const sName = tScheme(s.id, 'name', s.name);
    const sMinistry = tScheme(s.id, 'ministry', s.ministry);
    const sDesc = tScheme(s.id, 'description', s.description);
    const sBenefit = tScheme(s.id, 'benefit', s.benefit);

    return `
    <div class="scheme-card" style="box-shadow: 0 4px 10px rgba(0,0,0,0.05)">
      <div class="sc-head" style="padding:15px; gap:10px">
        <div class="sc-icon ${s.iconClass || 'g'}" style="width:40px; height:40px; font-size:18px">${s.icon || '🌾'}</div>
        <div class="sc-title">
          <h3 style="font-size:13px">${sName} <span class="${isCentral ? 'chip-central' : 'chip-state'}">${isCentral ? t('chip_central') || 'Central' : t('chip_state') || 'Maharashtra'}</span></h3>
          <div class="ministry" style="font-size:10px">${sMinistry}</div>
          <span class="app-status-chip ${appEntry ? (appEntry.stageIndex >= 1 ? 'applied' : 'visited') : ''}" id="chip-dash-${s.id}" style="display:${appEntry ? 'inline-flex' : 'none'}">
            ${appEntry ? (appEntry.stageIndex >= 1 ? t('applied_status') || '📝 Applied' : t('visited_status') || '👁 Visited') : ''}
          </span>
        </div>
      </div>
      <div class="sc-body" style="padding:12px 15px">
        <p style="font-size:11px; height:50px; overflow:hidden">${sDesc.substring(0, 95)}...</p>
        <div class="chips" style="margin-top:8px">
          <span class="chip chip-g">💰 ${t('dash_benefit_label') || 'Benefit:'} ${sBenefit}</span>
          <span class="chip chip-b">👤 ${catLabel}</span>
        </div>
      </div>
      <div class="sc-foot" style="padding:10px 15px">
        <span class="sc-benefit" style="font-size:12px">${t('dash_max_benefit_label') || 'Max:'} ₹${s.maxBenefit.toLocaleString('en-IN')}</span>
        <button class="btn-green" onclick="handleApplyClick(${s.id}, '${s.name.replace(/'/g, "\\'")}', '${s.applyUrl}')" style="padding:6px 12px; font-size:11px">
          ${appEntry ? t('visit_again_short') || '🔗 Visit' : t('apply_btn_short') || 'Apply →'}
        </button>
      </div>
    </div>`;
  }).join('');
  
  if (schemes.length > 6) {
    grid.innerHTML += `
      <div style="grid-column: span 3; text-align:center; margin-top:15px">
        <button class="btn-primary" onclick="showResults()" style="padding:10px 20px; font-size:12px">${t('view_all_schemes_btn', {count: schemes.length}) || `View All ${schemes.length} Schemes`}</button>
      </div>`;
  }
}

function renderDashboardTrackedApplications() {
  const container = document.getElementById('dashAppliedContainer');
  if (!container) return;

  if (trackedApps.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:32px; color:var(--muted); background:#fff; border-radius:12px; border:1px solid var(--border)">
        <div style="font-size:48px; margin-bottom:12px">📋</div>
        <p>No tracked applications yet. Click "Apply" on any scheme to start tracking your application status here.</p>
      </div>`;
    return;
  }

  // Sort by updatedAt descending
  const sortedApps = [...trackedApps].sort((a, b) => new Date(b.updatedAt || Date.now()) - new Date(a.updatedAt || Date.now()));

  container.innerHTML = sortedApps.map(app => {
    const stage = app.stageIndex || 0;
    return `
    <div class="app-item" style="margin-bottom:0; background:#FAFAFA; border:1px solid var(--border)">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px">
        <div class="app-item-head" style="margin-bottom:0; flex:1">
          <div class="app-item-icon" style="font-size:24px">${app.icon || '🌾'}</div>
          <div>
            <div class="app-item-name" style="font-size:14px; color:var(--green)">${app.schemeName}</div>
            <div class="app-item-ministry" style="font-size:11px">${app.ministry || ''}</div>
          </div>
        </div>
        <span class="status-pill ${stage === 0 ? 'pill-visited' : 'pill-applied'}" style="font-size:10px; padding:2px 8px">
          ${TIMELINE_STAGES[stage]}
        </span>
      </div>

      <div class="app-timeline" style="margin:15px 0">
        ${TIMELINE_STAGES.map((s, i) => `
          <div class="tl-step ${i < stage ? 'done' : i === stage ? 'active' : ''}">
            <div class="tl-dot" style="width:18px; height:18px; font-size:9px">${i < stage ? '✓' : i + 1}</div>
            <div class="tl-lbl" style="font-size:8px">${s.split(' ')[0]}</div>
          </div>`).join('')}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; border-top:1px solid var(--border); padding-top:10px; margin-top:10px">
        <div style="font-size:11px; color:var(--muted)">
          📅 Updated: ${new Date(app.updatedAt || Date.now()).toLocaleDateString('en-IN')}
        </div>
        <div style="display:flex; gap:6px">
          ${stage === 0 ? `<button class="app-update-btn" style="margin-top:0; padding:6px 12px; font-size:11px" onclick="markApplied(${app.schemeId})">✅ Mark Applied</button>` : ''}
          ${stage > 0 && stage < TIMELINE_STAGES.length - 1 ? `<button class="app-update-btn" style="margin-top:0; padding:6px 12px; font-size:11px" onclick="advanceStatus(${app.schemeId})">⬆️ Advance Status</button>` : ''}
          <button onclick="removeApp(${app.schemeId})" style="padding:6px 10px; background:none; border:1px solid #e0d5c5; border-radius:6px; font-size:11px; cursor:pointer; color:#999" title="Remove Tracking">🗑 Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function updateActivityTimeline(apps) {
  const timeline = document.getElementById('activityTimeline');
  if (apps.length === 0) {
    timeline.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--muted)">
        <div style="font-size:48px;margin-bottom:12px">📋</div>
        <p>No recent activity. Start applying for schemes to see your progress here!</p>
      </div>`;
    return;
  }
  
  const sortedApps = [...apps].sort((a, b) => new Date(b.updatedAt || Date.now()) - new Date(a.updatedAt || Date.now()));
  timeline.innerHTML = sortedApps.slice(0, 5).map(app => {
    const date = new Date(app.updatedAt || Date.now());
    const stage = TIMELINE_STAGES[app.stageIndex] || 'Visited';
    return `
      <div class="activity-item" style="display:flex;gap:12px;padding:12px;background:var(--cream);border-radius:10px">
        <div style="font-size:20px">${app.icon || '🌾'}</div>
        <div style="flex:1">
          <div style="font-weight:600;color:var(--green)">${app.schemeName}</div>
          <div style="font-size:12px;color:var(--muted)">${stage} • ${date.toLocaleDateString('en-IN')}</div>
        </div>
        <span class="status-pill ${app.stageIndex === 0 ? 'pill-visited' : 'pill-applied'}">${stage}</span>
      </div>`;
  }).join('');
}

function exportProfile() {
  const farmer = getSavedFarmer();
  if (!farmer) return;
  const matched = matchSchemes(farmer);
  
  const data = {
    profile: farmer,
    applications: trackedApps,
    eligibleSchemes: matched.map(s => ({
      name: s.name,
      benefit: s.benefit,
      maxBenefit: s.maxBenefit,
      applyUrl: s.applyUrl
    })),
    exportDate: new Date().toISOString()
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `farmer-profile-${farmer.name || 'data'}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('Profile data exported successfully!', 'success');
}

// ══════════════════════════════════════════════════════════════════
//  STEPPED FORM NAVIGATION
// ══════════════════════════════════════════════════════════════════
function nextStep(step) {
  if (step === 1) {
    const aadhaar = document.getElementById('aadhaarNum').value.replace(/\s/g, '');
    const pwd = document.getElementById('password').value;
    const cpwd = document.getElementById('confirmPassword').value;
    
    if (aadhaar.length !== 12 || !/^\d{12}$/.test(aadhaar)) {
      showToast('Aadhaar must be exactly 12 digits.', 'error');
      return;
    }
    if (pwd.length < 6) {
      showToast('Password must be at least 6 characters.', 'error');
      return;
    }
    if (pwd !== cpwd) {
      showToast('Passwords do not match.', 'error');
      return;
    }
    formData.aadhaar = aadhaar;
    formData.password = pwd;
  }
  else if (step === 2) {
    const name = document.getElementById('fullName').value.trim();
    const mobile = document.getElementById('mobileNum').value.replace(/\s/g, '');
    const email = document.getElementById('emailId').value.trim();
    const dob = document.getElementById('dob').value;
    const gender = document.getElementById('gender').value;
    const pinCode = document.getElementById('pinCode').value.trim();
    const state = document.getElementById('state').value;
    const district = document.getElementById('district').value;
    const address = document.getElementById('addressVal').value.trim();
    
    if (!name) {
      showToast('Please enter your full name.', 'error');
      return;
    }
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
      showToast('Please enter a valid 10-digit mobile number starting with 6-9.', 'error');
      return;
    }
    if (!dob) {
      showToast('Please enter your date of birth.', 'error');
      return;
    }
    if (!gender) {
      showToast('Please select your gender.', 'error');
      return;
    }
    if (!pinCode || !/^\d{6}$/.test(pinCode)) {
      showToast('Please enter a valid 6-digit PIN code.', 'error');
      return;
    }
    if (!state) {
      showToast('Please select state.', 'error');
      return;
    }
    if (!district) {
      showToast('Please select district.', 'error');
      return;
    }
    if (!address) {
      showToast('Please enter address.', 'error');
      return;
    }
    
    formData.name = name;
    formData.mobile = mobile;
    formData.email = email;
    formData.dob = dob;
    formData.gender = gender;
    formData.pinCode = pinCode;
    formData.state = state;
    formData.district = district;
    formData.address = address;
  }
  else if (step === 3) {
    const landOwnership = document.getElementById('landOwnership').value;
    const surveyNumber = document.getElementById('surveyNumber').value.trim();
    const landSizeAcres = document.getElementById('landSizeAcres').value;
    const landSizeGuntas = document.getElementById('landSizeGuntas').value;
    const irrigationType = document.getElementById('irrigationType').value;
    const farmerCategory = document.getElementById('farmerCategory').value;
    
    const cropChecked = [];
    document.querySelectorAll('input[name="crops"]:checked').forEach(cb => {
      cropChecked.push(cb.value);
    });
    
    if (!landOwnership) {
      showToast('Please select land ownership type.', 'error');
      return;
    }
    if (!surveyNumber) {
      showToast('Please enter survey number.', 'error');
      return;
    }
    
    const acres = parseFloat(landSizeAcres) || 0;
    const guntas = parseFloat(landSizeGuntas) || 0;
    if (acres < 0 || guntas < 0 || guntas >= 40) {
      showToast('Guntas must be between 0 and 39.', 'error');
      return;
    }
    if (acres === 0 && guntas === 0) {
      showToast('Please enter a valid land size.', 'error');
      return;
    }
    if (!irrigationType) {
      showToast('Please select irrigation type.', 'error');
      return;
    }
    if (!farmerCategory) {
      showToast('Please select farmer category.', 'error');
      return;
    }
    if (cropChecked.length === 0) {
      showToast('Please select at least one crop.', 'error');
      return;
    }
    
    formData.landOwnership = landOwnership;
    formData.surveyNumber = surveyNumber;
    formData.landSizeAcres = acres;
    formData.landSizeGuntas = guntas;
    formData.irrigationType = irrigationType;
    formData.farmerCategory = farmerCategory;
    formData.crops = cropChecked;
    
    // Setup compatible model fields
    formData.land = `${acres}-${guntas}`;
    formData.landType = irrigationType === 'Rain-fed' ? 'Dry' : 'Wet';
    formData.category = farmerCategory === 'Marginal Farmer' ? 'Marginal' : farmerCategory === 'Small Farmer' ? 'Small' : 'General';
  }
  
  document.getElementById(`step${step}`).classList.remove('active');
  document.getElementById(`step${step + 1}`).classList.add('active');
  document.getElementById(`ps${step}`).classList.remove('active');
  document.getElementById(`ps${step}`).classList.add('done');
  document.getElementById(`ps${step + 1}`).classList.add('active');
}

function prevStep(step) {
  document.getElementById(`step${step}`).classList.remove('active');
  document.getElementById(`step${step - 1}`).classList.add('active');
  document.getElementById(`ps${step}`).classList.remove('active');
  document.getElementById(`ps${step - 1}`).classList.remove('done');
  document.getElementById(`ps${step - 1}`).classList.add('active');
}

async function submitForm() {
  const category = document.getElementById('category').value;
  const income = document.getElementById('income').value;
  const consent = document.getElementById('consent').checked;
  const smsConsent = document.getElementById('smsConsent').checked;

  if (!category) {
    showToast('Please select your Caste Category.', 'error');
    return;
  }
  if (!income) {
    showToast('Please select income range category.', 'error');
    return;
  }
  if (!consent) {
    showToast('Please accept the consent checkbox.', 'error');
    return;
  }

  const kycAadhaarUrl = document.getElementById('kycAadhaarUrl').value;
  const kycPanUrl = document.getElementById('kycPanUrl').value;
  const kycFarmerIdUrl = document.getElementById('kycFarmerIdUrl').value;

  formData.category = category;
  formData.income = income;
  formData.sms = smsConsent;
  formData.kycAadhaarUrl = kycAadhaarUrl;
  formData.kycPanUrl = kycPanUrl;
  formData.kycFarmerIdUrl = kycFarmerIdUrl;

  document.getElementById('loadingOverlay').classList.add('show');
  document.getElementById('loadingText').textContent = 'Creating your account and matching schemes...';

  // Call Register API
  const data = await apiCall('/auth/register', 'POST', formData);
  
  document.getElementById('loadingOverlay').classList.remove('show');

  if (data && data.success) {
    saveSession(data.token, data.user.id, data.user.role, data.farmer);
    
    document.getElementById('step4').classList.remove('active');
    document.getElementById('ps4').classList.add('done');
    document.getElementById('successBox').classList.add('show');
    
    await fetchFarmerApplications();
    updateDashboard();
    
    showToast(`Registration successful! Welcome, ${data.farmer.name}! 🌾`, 'success', 5000);
    
    setTimeout(() => {
      document.getElementById('register').style.display = 'none';
      document.getElementById('dashboard').style.display = 'block';
      document.getElementById('dashboardLink').style.display = 'block';
      document.getElementById('registerNewUserLink').style.display = 'block';
      document.getElementById('authLink').style.display = 'none';
      document.getElementById('loginCta').style.display = 'none';
      document.getElementById('logoutLink').style.display = 'block';
      document.getElementById('successBox').classList.remove('show');
      
      // Update navigation active state
      document.querySelectorAll('.main-nav a').forEach(a => a.classList.remove('active'));
      document.getElementById('dashboardLink').classList.add('active');
    }, 2000);
  } else {
    showToast(data?.message || 'Registration failed.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════
//  AUTHENTICATION & SESSION
// ══════════════════════════════════════════════════════════════════
let activeLoginTab = 'farmer';

function switchLoginTab(type) {
  activeLoginTab = type;
  const farmerTab = document.getElementById('btnLoginTabFarmer');
  const adminTab = document.getElementById('btnLoginTabAdmin');
  const title = document.getElementById('loginTitle');
  const subtitle = document.getElementById('loginSubtitle');
  const farmerFields = document.getElementById('farmerLoginFields');
  const adminFields = document.getElementById('adminLoginFields');
  const toggleDiv = document.getElementById('loginToggleDiv');
  const pwdNote = document.getElementById('loginPasswordNote');
  const loginNoticeBar = document.getElementById('loginNoticeBar');

  if (type === 'farmer') {
    if (farmerTab) farmerTab.classList.add('active');
    if (adminTab) adminTab.classList.remove('active');
    if (title) title.textContent = t('login_title');
    if (subtitle) subtitle.textContent = t('login_subtitle');
    if (farmerFields) farmerFields.style.display = 'block';
    if (adminFields) adminFields.style.display = 'none';
    if (toggleDiv) toggleDiv.style.display = 'block';
    if (loginNoticeBar) loginNoticeBar.style.display = 'flex';
    if (pwdNote) pwdNote.textContent = t('login_note_password_farmer');
  } else {
    if (farmerTab) farmerTab.classList.remove('active');
    if (adminTab) adminTab.classList.add('active');
    if (title) title.textContent = t('login_title_admin') || '🏛️ Admin Portal Login';
    if (subtitle) subtitle.textContent = t('login_subtitle_admin') || 'Enter administrator login credentials';
    if (farmerFields) farmerFields.style.display = 'none';
    if (adminFields) adminFields.style.display = 'block';
    if (toggleDiv) toggleDiv.style.display = 'none';
    if (loginNoticeBar) loginNoticeBar.style.display = 'none';
    if (pwdNote) pwdNote.textContent = t('login_note_password_admin');
  }
}

async function handleLoginClick() {
  if (activeLoginTab === 'farmer') {
    await handleLogin();
  } else {
    await handleAdminLogin();
  }
}

async function handleAdminLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!username) {
    showToast('Enter Admin Username.', 'error');
    return;
  }
  if (!password) {
    showToast('Enter your password.', 'error');
    return;
  }

  const data = await apiCall('/admin/login', 'POST', { username, password }, false);

  if (data && data.success) {
    saveSession(data.token, data.admin.id, 'admin', null);
    showToast('Admin login successful! 🏛️', 'success');

    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('register').style.display = 'none';
    document.getElementById('authLink').style.display = 'none';
    document.getElementById('loginCta').style.display = 'none';
    document.getElementById('logoutLink').style.display = 'block';

    document.getElementById('adminDashboardLink').style.display = 'block';
    document.getElementById('dashboardLink').style.display = 'none';
    document.getElementById('registerNewUserLink').style.display = 'none';
    document.getElementById('dashboard').style.display = 'none';

    showAdminDashboard();
  } else {
    showToast(data?.message || 'Login failed. Please verify admin credentials.', 'error');
  }
}

async function handleLogin() {
  const aadhaar = document.getElementById('loginAadhaar').value.replace(/\s/g, '');
  const password = document.getElementById('loginPassword').value;
  
  if (aadhaar.length !== 12 || !/^\d{12}$/.test(aadhaar)) {
    showToast('Enter valid 12-digit Aadhaar number.', 'error');
    return;
  }
  if (!password) {
    showToast('Enter your password.', 'error');
    return;
  }
  
  const data = await apiCall('/auth/login', 'POST', { aadhaar, password });
  
  if (data && data.success) {
    saveSession(data.token, data.user.id, data.user.role, data.farmer);
    showToast('Login successful! Welcome back! 🌾', 'success');
    
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('register').style.display = 'none';
    document.getElementById('authLink').style.display = 'none';
    document.getElementById('loginCta').style.display = 'none';
    document.getElementById('logoutLink').style.display = 'block';
    
    if (data.user.role === 'admin') {
      document.getElementById('adminDashboardLink').style.display = 'block';
      document.getElementById('dashboardLink').style.display = 'none';
      document.getElementById('registerNewUserLink').style.display = 'none';
      document.getElementById('dashboard').style.display = 'none';
      showAdminDashboard();
    } else {
      document.getElementById('adminDashboardLink').style.display = 'none';
      document.getElementById('dashboardLink').style.display = 'block';
      document.getElementById('registerNewUserLink').style.display = 'block';
      document.getElementById('dashboard').style.display = 'block';
      await fetchFarmerApplications();
      updateDashboard();
      renderSchemeCards();
    }
  } else {
    showToast(data?.message || 'Login failed. Please verify credentials.', 'error');
  }
}

function handleLogout() {
  // Clear localStorage
  localStorage.removeItem('mfp_token');
  localStorage.removeItem('mfp_user_id');
  localStorage.removeItem('mfp_role');
  localStorage.removeItem('mfp_farmer');
  
  trackedApps = [];
  formData = { crops: [] };
  
  showToast('Logged out successfully.', 'info');
  
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'none';
  document.getElementById('loginSection').style.display = 'block';
  document.getElementById('dashboardLink').style.display = 'none';
  document.getElementById('registerNewUserLink').style.display = 'none';
  document.getElementById('adminDashboardLink').style.display = 'none';
  document.getElementById('authLink').style.display = 'block';
  document.getElementById('loginCta').style.display = 'block';
  document.getElementById('logoutLink').style.display = 'none';
  
  document.querySelectorAll('.main-nav a').forEach(a => a.classList.remove('active'));
  document.querySelector('.main-nav a[href="#home"]').classList.add('active');
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showLogin() {
  document.getElementById('loginSection').style.display = 'block';
  document.getElementById('register').style.display = 'none';
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'none';
  
  // Show registered user count (we can request from API or keep it 1.2Cr+)
  document.getElementById('userCountDisplay').textContent = "12,450+";
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetRegisterForm() {
  // Clear inputs
  document.getElementById('aadhaarNum').value = '';
  document.getElementById('password').value = '';
  document.getElementById('confirmPassword').value = '';
  document.getElementById('fullName').value = '';
  document.getElementById('mobileNum').value = '';
  document.getElementById('emailId').value = '';
  document.getElementById('dob').value = '';
  document.getElementById('gender').value = '';
  document.getElementById('pinCode').value = '';
  document.getElementById('state').value = 'Maharashtra';
  document.getElementById('district').value = '';
  document.getElementById('addressVal').value = '';
  
  document.getElementById('landOwnership').value = '';
  document.getElementById('surveyNumber').value = '';
  document.getElementById('landSizeAcres').value = '0';
  document.getElementById('landSizeGuntas').value = '0';
  document.getElementById('irrigationType').value = '';
  document.getElementById('farmerCategory').value = '';
  
  // reset checkboxes for crops
  document.querySelectorAll('input[name="crops"]').forEach(cb => cb.checked = false);
  
  // kyc
  document.getElementById('kycAadhaarUrl').value = '';
  document.getElementById('kycPanUrl').value = '';
  document.getElementById('kycFarmerIdUrl').value = '';
  document.getElementById('category').value = '';
  
  document.getElementById('income').value = '';
  document.getElementById('consent').checked = false;
  document.getElementById('smsConsent').checked = false;
  
  // Clear password strength indicator
  const bar = document.getElementById('strengthFill');
  if (bar) bar.className = 'strength-fill';
  const txt = document.getElementById('strengthText');
  if (txt) txt.textContent = '';

  // Reset multi-step visual styles
  for (let i = 1; i <= 4; i++) {
    const stepEl = document.getElementById(`step${i}`);
    if (stepEl) {
      stepEl.classList.remove('active');
    }
    const psEl = document.getElementById(`ps${i}`);
    if (psEl) {
      psEl.className = 'prog-step';
    }
  }
  
  // Make Step 1 active
  document.getElementById('step1').classList.add('active');
  document.getElementById('ps1').classList.add('active');
  
  // Hide success box
  document.getElementById('successBox').classList.remove('show');
  
  // Reset formData
  formData = { crops: [] };
}

function showRegister() {
  resetRegisterForm();
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('register').style.display = 'block';
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showRegisterNewUser() {
  resetRegisterForm();
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('register').style.display = 'block';
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'none';
  
  // Highlight the Register New User link in navbar
  document.querySelectorAll('.main-nav a').forEach(a => a.classList.remove('active'));
  const link = document.getElementById('registerNewUserLink');
  if (link) link.classList.add('active');
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ══════════════════════════════════════════════════════════════════
//  RESULTS MODAL
// ══════════════════════════════════════════════════════════════════
function showResults() {
  const farmer = getSavedFarmer();
  if (!farmer) {
    showToast('Please login or register first.', 'warning');
    showLogin();
    return;
  }
  
  document.getElementById('farmerNameDisplay').textContent = `${t('results_for') || 'Results for:'} ${farmer.name || 'Farmer'} | ${farmer.district}`;
  document.getElementById('farmerSummary').innerHTML = `
    <div class="fs-item"><div class="val">${farmer.name || '—'}</div><div class="key">${t('label_fullName') || 'Farmer Name'}</div></div>
    <div class="fs-item"><div class="val">₹${(farmer.income || '').replace(/-/g, ' – ₹')}</div><div class="key">${t('label_incomeCategory') || 'Annual Income'}</div></div>
    <div class="fs-item"><div class="val">${farmer.land || '—'} acres</div><div class="key">${t('label_landHolding') || 'Land Holding'}</div></div>
    <div class="fs-item"><div class="val">${farmer.category || '—'}</div><div class="key">${t('label_casteCategory') || 'Category'}</div></div>
  `;
  
  const matched = matchSchemes(farmer);
  const totalBen = matched.reduce((s, m) => s + (m.maxBenefit || 0), 0);
  document.getElementById('resultsCount').innerHTML = `<strong>${t('results_count_found', {count: matched.length}) || `${matched.length} eligible schemes found`}</strong> ${t('results_for_profile') || 'for your profile. Total potential annual benefit:'} <strong>₹${totalBen.toLocaleString('en-IN')}</strong>`;

  document.getElementById('schemeResults').innerHTML = matched.map(s => {
    const isCentral = s.tags.includes('central');
    const appEntry = trackedApps.find(a => a.schemeId === s.id);
    const govBadge = `<span class="${isCentral ? 'chip-central' : 'chip-state'}">${isCentral ? t('chip_central') || 'Central Govt' : t('chip_state') || 'Maharashtra State'}</span>`;
    
    // Caste labels translation
    let catLabel = s.eligibility.category;
    if (s.eligibility.category === 'all') {
      catLabel = t('search_all_categories') || 'All Categories';
    } else if (s.eligibility.category === 'SC only') {
      catLabel = '🔵 ' + (t('sc_only_label') || 'SC Only');
    } else if (s.eligibility.category === 'ST only') {
      catLabel = '🏹 ' + (t('st_only_label') || 'ST Only');
    }

    const sName = tScheme(s.id, 'name', s.name);
    const sMinistry = tScheme(s.id, 'ministry', s.ministry);
    const sDesc = tScheme(s.id, 'description', s.description);
    const sBenefit = tScheme(s.id, 'benefit', s.benefit);
    const sCondition = tScheme(s.id, 'condition', s.eligibility?.condition || 'No specific condition');

    return `
    <div class="result-scheme">
      <div class="rs-head" onclick="toggleScheme(${s.id})">
        <div class="rs-icon" style="background:${s.iconClass === 'g' ? 'var(--green-lt)' : 'var(--saffron-lt)'}">${s.icon || '🌾'}</div>
        <div class="rs-info">
          <h3>${sName} ${govBadge}</h3>
          <div class="rs-ministry">${sMinistry}</div>
          <div class="rs-eligible">✅ ${t('eligible_expand_msg') || 'You are eligible — click to expand'}</div>
          ${appEntry ? `<span class="app-status-chip ${appEntry.stageIndex >= 1 ? 'applied' : 'visited'}" style="display:inline-flex;margin-top:4px">${appEntry.stageIndex >= 1 ? t('applied_status') || '📝 Applied' : t('visited_status') || '👁 Visited Portal'}</span>` : ''}
        </div>
        <div class="rs-badge">${sBenefit}</div>
      </div>
      <div class="rs-details" id="rd-${s.id}">
        <p>${sDesc}</p>
        <div class="cond-box"><strong style="color:var(--green)">${t('eligibility_condition_label') || 'Eligibility Condition:'}</strong> ${sCondition}</div>
        <div class="detail-grid">
          <div class="di"><div class="dk">${t('benefit_type_label') || 'Benefit Type'}</div><div class="dv">${s.type || 'Direct Benefit'}</div></div>
          <div class="di"><div class="dk">${t('max_benefit_label') || 'Max Benefit'}</div><div class="dv">${sBenefit}</div></div>
          <div class="di"><div class="dk">${t('deadline_label') || 'Deadline'}</div><div class="dv">${s.deadline}</div></div>
        </div>
        <div class="docs-row">${s.documents ? s.documents.map(d => `<span class="doc-chip">📄 ${d}</span>`).join('') : ''}</div>
        <div class="apply-actions">
          <button class="apply-link" onclick="handleApplyClick(${s.id}, '${s.name.replace(/'/g, "\\'")}', '${s.applyUrl}')">
            🔗 ${t('apply_on_portal') || 'Apply on'} ${s.source || 'portal'} ${appEntry ? t('revisit_msg') || '(Revisit)' : ''}
          </button>
          <button class="track-btn-rs ${appEntry && appEntry.stageIndex >= 1 ? 'tracked' : ''}" onclick="${appEntry && appEntry.stageIndex >= 1 ? `removeApp(${s.id})` : `markApplied(${s.id})`}">
            ${appEntry && appEntry.stageIndex >= 1 ? t('applied_remove_btn') || '✅ Applied — Remove' : t('mark_applied_btn') || '📌 Mark as Applied'}
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
  
  document.getElementById('resultsModal').classList.add('show');
}

function matchSchemes(data) {
  if (!data) return [];
  const matched = SCHEMES.filter(s => {
    // 1. State Matching
    if (s.eligibility?.state && s.eligibility.state !== 'all' && data.state) {
      if (s.eligibility.state.toLowerCase() !== data.state.toLowerCase()) {
        return false;
      }
    }

    // 2. District Matching
    if (s.eligibility?.districts && s.eligibility.districts.length > 0 && !s.eligibility.districts.includes('all') && data.district) {
      const hasDistrict = s.eligibility.districts.some(d => d.toLowerCase() === data.district.toLowerCase());
      if (!hasDistrict) return false;
    }

    // 3. Gender Matching
    if (s.eligibility?.gender && s.eligibility.gender !== 'all' && data.gender) {
      if (s.eligibility.gender.toLowerCase() !== data.gender.toLowerCase()) {
        return false;
      }
    }

    // 4. Caste Category Matching
    if (s.eligibility?.category && s.eligibility.category !== 'all') {
      const reqCat = s.eligibility.category.replace(' only', '').trim().toLowerCase();
      const userCat = data.category ? data.category.toLowerCase() : '';
      if (reqCat && userCat !== reqCat) {
        if (reqCat === 'sc' && data.category !== 'SC') return false;
        if (reqCat === 'st' && data.category !== 'ST') return false;
      }
    }

    // 5. Age Matching
    if (data.dob) {
      const birthDate = new Date(data.dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      if (s.eligibility?.ageMin !== undefined && s.eligibility.ageMin > 0 && age < s.eligibility.ageMin) return false;
      if (s.eligibility?.ageMax !== undefined && s.eligibility.ageMax < 120 && age > s.eligibility.ageMax) return false;
    }

    // 6. Occupation Matching
    if (s.eligibility?.occupation && s.eligibility.occupation !== 'all' && data.occupation) {
      if (s.eligibility.occupation.toLowerCase() !== data.occupation.toLowerCase()) {
        return false;
      }
    }

    // 7. Income Matching
    const sIncome = s.eligibility?.income;
    const incOk = sIncome === 'all' || !data.income ||
      (typeof sIncome === 'string' && sIncome === data.income) ||
      (Array.isArray(sIncome) && sIncome.includes(data.income));
    if (!incOk) return false;

    // 8. Land Ownership Matching
    if (s.eligibility?.landOwnership && s.eligibility.landOwnership.length > 0 && !s.eligibility.landOwnership.includes('all') && data.landOwnership) {
      const ownershipOk = s.eligibility.landOwnership.some(o => o.toLowerCase() === data.landOwnership.toLowerCase());
      if (!ownershipOk) return false;
    }

    // 9. Irrigation Type Matching
    if (s.eligibility?.irrigationType && s.eligibility.irrigationType.length > 0 && !s.eligibility.irrigationType.includes('all') && data.irrigationType) {
      const irrigationOk = s.eligibility.irrigationType.some(i => i.toLowerCase() === data.irrigationType.toLowerCase());
      if (!irrigationOk) return false;
    }

    // 10. Crops Matching (intersection)
    if (s.eligibility?.crops && s.eligibility.crops.length > 0 && !s.eligibility.crops.includes('all')) {
      if (!data.crops || data.crops.length === 0) return false;
      const cropMatch = data.crops.some(fc => s.eligibility.crops.some(sc => sc.toLowerCase() === fc.toLowerCase()));
      if (!cropMatch) return false;
    }

    // 11. Land Size Matching (acres + guntas / 40)
    const farmerLandSize = (data.landSizeAcres || 0) + ((data.landSizeGuntas || 0) / 40);
    if (s.eligibility?.landSizeMin !== undefined && farmerLandSize < s.eligibility.landSizeMin) return false;
    if (s.eligibility?.landSizeMax !== undefined && farmerLandSize > s.eligibility.landSizeMax) return false;

    // 12. KYC Status matching
    if (s.eligibility?.kycRequired && data.kycStatus !== 'Verified') {
      return false;
    }

    return true;
  });

  // Calculate recommendation scores
  const scored = matched.map(s => {
    let score = 50;
    if (s.eligibility?.crops && s.eligibility.crops.length > 0 && !s.eligibility.crops.includes('all') && data.crops) {
      const hasPreferredCrop = data.crops.some(fc => s.eligibility.crops.some(sc => sc.toLowerCase() === fc.toLowerCase()));
      if (hasPreferredCrop) score += 15;
    }
    if (data.farmerCategory === 'Marginal Farmer' || data.farmerCategory === 'Small Farmer') {
      score += 15;
    }
    const maxBenefitPoints = Math.min(20, Math.round(((s.maxBenefit || 0) / 200000) * 10));
    score += maxBenefitPoints;

    return {
      ...s,
      recommendationScore: score
    };
  });

  return scored.sort((a, b) => b.recommendationScore - a.recommendationScore);
}

function toggleScheme(id) {
  document.getElementById(`rd-${id}`)?.classList.toggle('open');
}
function closeModal() {
  document.getElementById('resultsModal').classList.remove('show');
}
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ══════════════════════════════════════════════════════════════════
//  ADMIN PANEL LOGIC
// ══════════════════════════════════════════════════════════════════
function showAdminDashboard() {
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('register').style.display = 'none';
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'block';
  
  document.querySelectorAll('.main-nav a').forEach(a => a.classList.remove('active'));
  document.getElementById('adminDashboardLink').classList.add('active');
  
  switchAdminTab('dashboard');
}

function switchAdminTab(tab) {
  const tabs = ['dashboard', 'schemes', 'farmers', 'applications', 'notifications', 'settings'];
  const buttons = {
    dashboard: document.getElementById('btnAdminDashTab'),
    schemes: document.getElementById('btnManageSchemes'),
    farmers: document.getElementById('btnViewFarmers'),
    applications: document.getElementById('btnViewApplications'),
    notifications: document.getElementById('btnAdminNotif'),
    settings: document.getElementById('btnAdminSettings')
  };
  const views = {
    dashboard: document.getElementById('adminOverviewTab'),
    schemes: document.getElementById('adminSchemesTab'),
    farmers: document.getElementById('adminFarmersTab'),
    applications: document.getElementById('adminApplicationsTab'),
    notifications: document.getElementById('adminNotificationsTab'),
    settings: document.getElementById('adminSettingsTab')
  };

  tabs.forEach(t => {
    if (buttons[t]) {
      if (t === tab) buttons[t].classList.add('active');
      else buttons[t].classList.remove('active');
    }
    if (views[t]) {
      if (t === tab) views[t].style.display = 'block';
      else views[t].style.display = 'none';
    }
  });

  if (tab === 'dashboard') {
    loadAdminDashboard();
  } else if (tab === 'schemes') {
    loadAdminSchemes();
  } else if (tab === 'farmers') {
    loadAdminFarmers();
  } else if (tab === 'applications') {
    loadAdminApplications();
  } else if (tab === 'notifications') {
    loadAdminNotifications();
  }
}

async function loadAdminDashboard() {
  const data = await apiCall('/admin/dashboard', 'GET');
  if (data && data.success) {
    const tbody = document.getElementById('recentRegistrationsTableBody');
    if (tbody && data.recentRegistrations) {
      tbody.innerHTML = data.recentRegistrations.map(f => {
        const regDate = f.createdAt ? new Date(f.createdAt).toLocaleDateString('en-IN') : '—';
        return `
          <tr>
            <td><strong>${f.name}</strong></td>
            <td>${f.mobile}</td>
            <td>${f.district}</td>
            <td>${f.state}</td>
            <td>${regDate}</td>
          </tr>
        `;
      }).join('');
    }
  }
  await loadAdminAnalytics();
}

async function loadAdminSchemes() {
  await fetchSchemes();
  const tbody = document.getElementById('adminSchemesTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = SCHEMES.map(s => {
    return `
      <tr>
        <td><strong>${s.id}</strong></td>
        <td>
          <span style="font-size:1.2em;margin-right:6px">${s.icon || '🌾'}</span>
          <strong>${s.name.split(' — ')[0]}</strong>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${s.name}</div>
        </td>
        <td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${s.ministry}</td>
        <td style="color:var(--green);font-weight:700">${s.benefit}</td>
        <td><span class="chip chip-b">${s.type || 'Subsidy'}</span></td>
        <td><span class="chip ${s.status === 'unpublished' ? 'chip-state' : 'chip-g'}">${s.status || 'published'}</span></td>
        <td>
          <button class="admin-btn-edit" onclick="openSchemeModal(${s.id})">✏️ Edit</button>
          <button class="admin-btn-delete" onclick="handleSchemeDelete('${s._id}', '${s.name.replace(/'/g, "\\'")}')">🗑 Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadAdminFarmers() {
  const search = document.getElementById('adminFarmerSearchInput')?.value || '';
  const category = document.getElementById('adminFarmerCategoryFilter')?.value || 'all';
  const district = document.getElementById('adminFarmerDistrictFilter')?.value || 'all';
  
  const query = `search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&district=${encodeURIComponent(district)}`;
  const data = await apiCall(`/admin/farmers?${query}`, 'GET');
  
  if (data && data.success) {
    const farmers = data.farmers;
    const countEl = document.getElementById('adminFarmerCount');
    if (countEl) countEl.textContent = farmers.length;
    
    const tbody = document.getElementById('adminFarmersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = farmers.map(f => {
      const rawAadhaar = f.userId?.aadhaar || '—';
      const formattedAadhaar = rawAadhaar.replace(/(\d{4})(?=\d)/g, '$1 ');
      
      const incomeStr = f.income || '';
      const formattedIncome = `₹${incomeStr.replace(/-/g, ' - ₹')}`;
      
      const docsHtml = [
        f.kycAadhaarUrl ? `<a href="${API_URL.replace('/api', '')}${f.kycAadhaarUrl}" target="_blank" style="color:var(--green);text-decoration:underline">Aadhaar</a>` : '',
        f.kycPanUrl ? `<a href="${API_URL.replace('/api', '')}${f.kycPanUrl}" target="_blank" style="color:var(--green);text-decoration:underline">PAN</a>` : '',
        f.kycFarmerIdUrl ? `<a href="${API_URL.replace('/api', '')}${f.kycFarmerIdUrl}" target="_blank" style="color:var(--green);text-decoration:underline">FarmerID</a>` : ''
      ].filter(Boolean).join(' | ') || 'No docs';

      const statusCls = f.kycStatus === 'Verified' ? 'chip-g' : f.kycStatus === 'Rejected' ? 'chip-state' : 'chip-o';
      const statusText = `<span class="chip ${statusCls}">${f.kycStatus || 'Pending'}</span>`;

      const actionsHtml = `
        <div style="display:flex;gap:4px">
          <button class="btn-green" style="padding:4px 8px;font-size:11px" onclick="verifyFarmerKyc('${f._id}', 'Verified')">Approve</button>
          <button class="admin-btn-delete" style="padding:4px 8px;font-size:11px;margin-top:0" onclick="verifyFarmerKyc('${f._id}', 'Rejected')">Reject</button>
        </div>
      `;

      return `
        <tr>
          <td><strong>${f.name}</strong></td>
          <td style="font-family:monospace;letter-spacing:0.5px">${formattedAadhaar}</td>
          <td>${f.district} / ${f.taluka || '—'}</td>
          <td>${f.land || '—'} acres (${f.landType || '—'})</td>
          <td>${formattedIncome}</td>
          <td><span class="chip chip-o">${f.category || 'General'}</span></td>
          <td style="font-size:12px">${docsHtml}</td>
          <td>${statusText}</td>
          <td>${actionsHtml}</td>
        </tr>
      `;
    }).join('');
  }
}

function resetAdminFarmerFilters() {
  const searchInput = document.getElementById('adminFarmerSearchInput');
  const catFilter = document.getElementById('adminFarmerCategoryFilter');
  const distFilter = document.getElementById('adminFarmerDistrictFilter');
  
  if (searchInput) searchInput.value = '';
  if (catFilter) catFilter.value = 'all';
  if (distFilter) distFilter.value = 'all';
  
  loadAdminFarmers();
}

async function exportFarmerList() {
  const search = document.getElementById('adminFarmerSearchInput')?.value || '';
  const category = document.getElementById('adminFarmerCategoryFilter')?.value || 'all';
  const district = document.getElementById('adminFarmerDistrictFilter')?.value || 'all';
  
  const query = `search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&district=${encodeURIComponent(district)}`;
  const data = await apiCall(`/admin/farmers?${query}`, 'GET');
  
  if (data && data.success) {
    const blob = new Blob([JSON.stringify(data.farmers, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `farmers-list-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Farmers list exported successfully!', 'success');
  } else {
    showToast('Failed to export farmers list.', 'error');
  }
}

function openSchemeModal(schemeId = null) {
  const modal = document.getElementById('schemeModal');
  const title = document.getElementById('schemeModalTitle');
  const form = document.getElementById('schemeForm');
  
  form.reset();
  document.getElementById('editSchemeId').value = '';
  
  if (schemeId) {
    title.textContent = 'Edit Government Scheme';
    const s = SCHEMES.find(item => item.id === schemeId);
    if (s) {
      document.getElementById('editSchemeId').value = s._id;
      document.getElementById('schemeName').value = s.name;
      document.getElementById('schemeIcon').value = s.icon || '🌾';
      document.getElementById('schemeMinistry').value = s.ministry || '';
      document.getElementById('schemeType').value = s.type || '';
      document.getElementById('schemeDescription').value = s.description || '';
      document.getElementById('schemeBenefit').value = s.benefit || '';
      document.getElementById('schemeMaxBenefit').value = s.maxBenefit || 0;
      document.getElementById('schemeApplyUrl').value = s.applyUrl || '';
      document.getElementById('schemeSource').value = s.source || '';
      document.getElementById('schemeCategory').value = s.eligibility?.category || 'all';
      document.getElementById('schemeDeadline').value = s.deadline || 'Ongoing';
      document.getElementById('schemeCondition').value = s.eligibility?.condition || '';
      document.getElementById('schemeDocuments').value = s.documents ? s.documents.join(', ') : 'Aadhaar, Land Records, Bank Account';
      document.getElementById('schemeState').value = s.eligibility?.state || 'Maharashtra';
      document.getElementById('schemeStatus').value = s.status || 'published';
    }
  } else {
    title.textContent = 'Add Government Scheme';
    document.getElementById('schemeState').value = 'Maharashtra';
    document.getElementById('schemeStatus').value = 'published';
  }
  
  modal.classList.add('show');
}

function closeSchemeModal() {
  document.getElementById('schemeModal').classList.remove('show');
}

async function handleSchemeSubmit(event) {
  event.preventDefault();
  
  const editId = document.getElementById('editSchemeId').value;
  const tags = ['state', 'all'];
  const typeLower = document.getElementById('schemeType').value.toLowerCase();
  const descLower = document.getElementById('schemeDescription').value.toLowerCase();
  const nameLower = document.getElementById('schemeName').value.toLowerCase();
  
  if (nameLower.includes('insurance') || descLower.includes('insurance') || typeLower.includes('insurance')) tags.push('insurance');
  if (descLower.includes('irrigation') || nameLower.includes('pond') || descLower.includes('drip')) tags.push('irrigation');
  if (descLower.includes('solar') || descLower.includes('pump') || descLower.includes('tractor') || descLower.includes('equipment')) tags.push('equipment');
  if (descLower.includes('horticulture') || descLower.includes('fruit')) tags.push('horticulture');
  
  const docs = document.getElementById('schemeDocuments').value.split(',').map(d => d.trim()).filter(d => d.length > 0);
  
  const payload = {
    name: document.getElementById('schemeName').value,
    icon: document.getElementById('schemeIcon').value,
    iconClass: 'g',
    ministry: document.getElementById('schemeMinistry').value,
    type: document.getElementById('schemeType').value,
    description: document.getElementById('schemeDescription').value,
    benefit: document.getElementById('schemeBenefit').value,
    maxBenefit: parseInt(document.getElementById('schemeMaxBenefit').value) || 0,
    applyUrl: document.getElementById('schemeApplyUrl').value,
    source: document.getElementById('schemeSource').value,
    tags,
    eligibility: {
      category: document.getElementById('schemeCategory').value,
      condition: document.getElementById('schemeCondition').value,
      income: 'all',
      land: 'all',
      state: document.getElementById('schemeState').value || 'Maharashtra'
    },
    status: document.getElementById('schemeStatus').value || 'published',
    deadline: document.getElementById('schemeDeadline').value,
    documents: docs
  };
  
  let result;
  if (editId) {
    result = await apiCall(`/admin/schemes/${editId}`, 'PUT', payload);
  } else {
    result = await apiCall('/admin/schemes', 'POST', payload);
  }
  
  if (result && result.success) {
    showToast(result.message || 'Scheme saved successfully!', 'success');
    closeSchemeModal();
    loadAdminSchemes();
  } else {
    showToast(result?.message || 'Failed to save scheme.', 'error');
  }
}

async function handleSchemeDelete(mongoId, schemeName) {
  if (confirm(`Are you sure you want to delete "${schemeName.split(' — ')[0]}"? This action cannot be undone.`)) {
    const result = await apiCall(`/admin/schemes/${mongoId}`, 'DELETE');
    if (result && result.success) {
      showToast('Scheme deleted successfully.', 'success');
      loadAdminSchemes();
    } else {
      showToast(result?.message || 'Failed to delete scheme.', 'error');
    }
  }
}

async function handleNotificationSubmit(event) {
  event.preventDefault();
  const title = document.getElementById('notifTitle').value.trim();
  const message = document.getElementById('notifMessage').value.trim();
  const type = document.getElementById('notifType').value;

  if (!title || !message) {
    showToast('Title and message are required', 'error');
    return;
  }

  const res = await apiCall('/admin/notifications', 'POST', { title, message, type });
  if (res && res.success) {
    showToast('Notification broadcast sent successfully!', 'success');
    document.getElementById('adminNotificationForm').reset();
    loadAdminNotifications();
  } else {
    showToast(res?.message || 'Failed to send notification', 'error');
  }
}

async function loadAdminNotifications() {
  const data = await apiCall('/admin/notifications', 'GET');
  const container = document.getElementById('adminNotificationsList');
  if (!container) return;

  if (data && data.success && data.notifications && data.notifications.length > 0) {
    container.innerHTML = data.notifications.map(n => {
      const date = n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';
      let typeBadge = '📢 Announcement';
      if (n.type === 'scheme_alert') typeBadge = '🌾 Scheme Alert';
      else if (n.type === 'deadline') typeBadge = '⏰ Deadline';

      return `
        <div style="background:#fff;border-radius:12px;padding:16px;border:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span class="chip chip-o" style="font-size:10px">${typeBadge}</span>
            <span style="font-size:11px;color:var(--muted)">${date}</span>
          </div>
          <h4 style="color:var(--green);margin:0 0 6px">${n.title}</h4>
          <p style="font-size:12px;margin:0;color:#555">${n.message}</p>
        </div>
      `;
    }).join('');
  } else {
    container.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--muted);background:#fff;border-radius:12px;border:1px solid var(--border)">
        <p>No broadcast history available. Send a notification to start!</p>
      </div>
    `;
  }
}

async function handleAdminPasswordChange(event) {
  event.preventDefault();
  const oldPassword = document.getElementById('adminOldPassword').value;
  const newPassword = document.getElementById('adminNewPassword').value;
  const confirmNewPassword = document.getElementById('adminConfirmNewPassword').value;

  if (newPassword.length < 6) {
    showToast('New password must be at least 6 characters long.', 'error');
    return;
  }

  if (newPassword !== confirmNewPassword) {
    showToast('New passwords do not match.', 'error');
    return;
  }

  const res = await apiCall('/admin/change-password', 'POST', { oldPassword, newPassword });
  if (res && res.success) {
    showToast('Administrator password updated successfully!', 'success');
    document.getElementById('adminPasswordForm').reset();
  } else {
    showToast(res?.message || 'Failed to update password.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════
//  INPUT FORMATTERS & VALIDATORS
// ══════════════════════════════════════════════════════════════════
function fmtAadhaar(el) {
  let val = el.value.replace(/\s/g, '').replace(/\D/g, '');
  let formatted = '';
  for (let i = 0; i < val.length; i++) {
    if (i > 0 && i % 4 === 0) formatted += ' ';
    formatted += val[i];
  }
  el.value = formatted;
}

function updatePasswordStrength() {
  const pwd = document.getElementById('password').value;
  const bar = document.getElementById('strengthFill');
  const txt = document.getElementById('strengthText');
  
  if (!pwd) {
    bar.className = 'strength-fill';
    txt.textContent = '';
    return;
  }
  
  let score = 0;
  if (pwd.length >= 6) score++;
  if (/[A-Z]/.test(pwd) || /[a-z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  
  if (score <= 1) {
    bar.className = 'strength-fill strength-weak';
    txt.textContent = 'Weak';
    txt.style.color = '#f44336';
  } else if (score === 2 || score === 3) {
    bar.className = 'strength-fill strength-medium';
    txt.textContent = 'Medium';
    txt.style.color = '#ff9800';
  } else {
    bar.className = 'strength-fill strength-strong';
    txt.textContent = 'Strong';
    txt.style.color = '#4caf50';
  }
}

// ══════════════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════
let toastTimer;
function showToast(msg, type = 'success', duration = 4000) {
  const t = document.getElementById('toastNotif');
  const icons = { success: '✅', error: '❌', info: '📢', warning: '⚠️' };
  
  document.getElementById('toastIcon').textContent = icons[type] || '📢';
  document.getElementById('toastTitle').textContent = type === 'success' 
    ? 'Success!' 
    : type === 'error' 
      ? 'Error' 
      : type === 'warning' 
        ? 'Notice' 
        : 'Info';
  document.getElementById('toastMsg').textContent = msg;
  
  t.className = `toast-notif show ${type === 'error' ? 'warn' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(closeToast, duration);
}
function closeToast() {
  document.getElementById('toastNotif')?.classList.remove('show');
}

// ══════════════════════════════════════════════════════════════════
//  INIT & ROUTING
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Load schemes from backend
  await fetchSchemes();
  renderSchemeCards();

  const userCountDisplay = document.getElementById('userCountDisplay');
  if (userCountDisplay) {
    userCountDisplay.textContent = "12,450+";
  }

  // Restore session
  const token = getToken();
  const role = getRole();
  const savedFarmer = getSavedFarmer();
  
  if (token) {
    document.getElementById('authLink').style.display = 'none';
    document.getElementById('loginCta').style.display = 'none';
    document.getElementById('logoutLink').style.display = 'block';
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('register').style.display = 'none';
    
    if (role === 'admin') {
      document.getElementById('adminDashboardLink').style.display = 'block';
      document.getElementById('dashboardLink').style.display = 'none';
      document.getElementById('registerNewUserLink').style.display = 'none';
      document.getElementById('dashboard').style.display = 'none';
      showAdminDashboard();
    } else {
      // Robust profile load: if missing from localStorage, fetch from API
      let farmer = savedFarmer;
      if (!farmer) {
        const profileData = await apiCall('/farmer/profile', 'GET');
        if (profileData && profileData.success) {
          farmer = profileData.farmer;
          localStorage.setItem('mfp_farmer', JSON.stringify(farmer));
        } else {
          // Token is expired, invalid, or profile doesn't exist
          handleLogout();
          return;
        }
      }

      document.getElementById('dashboardLink').style.display = 'block';
      document.getElementById('registerNewUserLink').style.display = 'block';
      document.getElementById('dashboard').style.display = 'block';
      document.getElementById('adminDashboardLink').style.display = 'none';
      
      // Fetch applications and update UI
      await fetchFarmerApplications();
      updateDashboard();
      renderSchemeCards();
      
      // Welcome back banner
      setTimeout(() => {
        document.getElementById('returnBannerTitle').textContent = `Welcome back, ${farmer.name}!`;
        document.getElementById('returnBannerMsg').textContent = `You have ${trackedApps.length} tracked applications. Check their status.`;
        const banner = document.getElementById('returnBanner');
        banner.classList.add('show');
        const btn = banner.querySelector('.rb-btn-primary');
        btn.textContent = '📋 View My Applications';
        btn.onclick = () => {
          openAppPanel();
          dismissReturnBanner();
        };
      }, 2000);
    }
  } else {
    // Show login by default if not authenticated
    showLogin();
  }

  // Intercept links for SPA routing
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      
      // Navigation highlight
      document.querySelectorAll('.main-nav a').forEach(navA => navA.classList.remove('active'));
      a.classList.add('active');
      
      if (href === '#home') {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Restore visibility based on auth
        if (getToken()) {
          if (getRole() === 'admin') {
            document.getElementById('adminDashboard').style.display = 'block';
          } else {
            document.getElementById('dashboard').style.display = 'block';
          }
        } else {
          showLogin();
        }
      } else if (href === '#schemes') {
        // Schemes section is always visible
      } else if (href === '#dashboard') {
        e.preventDefault();
        if (getToken() && getRole() === 'farmer') {
          document.getElementById('dashboard').style.display = 'block';
          document.getElementById('loginSection').style.display = 'none';
          document.getElementById('register').style.display = 'none';
          window.scrollTo({ top: document.getElementById('dashboard').offsetTop - 80, behavior: 'smooth' });
        } else {
          showLogin();
        }
      } else if (href === '#adminDashboard') {
        e.preventDefault();
        if (getToken() && getRole() === 'admin') {
          showAdminDashboard();
          window.scrollTo({ top: document.getElementById('adminDashboard').offsetTop - 80, behavior: 'smooth' });
        } else {
          showLogin();
        }
      }
    });
  });
});

// ══════════════════════════════════════════════════════════════════
//  KYC FILE UPLOAD CLIENT LOGIC & ADMIN EXPANSIONS
// ══════════════════════════════════════════════════════════════════
async function uploadKYCFile(field) {
  const fileInput = document.getElementById(`${field}File`);
  const statusEl = document.getElementById(`${field}Status`);
  const urlInput = document.getElementById(`${field}Url`);
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;
  const file = fileInput.files[0];
  
  if (file.size > 5 * 1024 * 1024) {
    showToast('File size exceeds 5MB limit.', 'error');
    fileInput.value = '';
    return;
  }
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  if (!allowedTypes.includes(file.type)) {
    showToast('Invalid file format. Only JPEG, PNG, and PDF are allowed.', 'error');
    fileInput.value = '';
    return;
  }

  statusEl.textContent = '⏳ Uploading file...';
  statusEl.style.color = 'var(--saffron)';

  const formDataObj = new FormData();
  formDataObj.append('file', file);

  try {
    const token = getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_URL}/upload`, {
      method: 'POST',
      headers,
      body: formDataObj
    });
    const data = await res.json();
    if (res.ok && data.success) {
      urlInput.value = data.fileUrl;
      statusEl.textContent = '✅ Uploaded successfully!';
      statusEl.style.color = 'var(--green)';
      showToast('Document uploaded successfully!', 'success');
      formData[`${field}Url`] = data.fileUrl;
    } else {
      statusEl.textContent = '❌ Upload failed. Try again.';
      statusEl.style.color = '#f44336';
      showToast(data.message || 'Upload failed', 'error');
    }
  } catch (error) {
    console.error('File upload error:', error);
    statusEl.textContent = '❌ Upload error.';
    statusEl.style.color = '#f44336';
    showToast('Network error during upload', 'error');
  }
}

async function verifyFarmerKyc(id, status) {
  const res = await apiCall(`/farmer/${id}/kyc`, 'PUT', { status });
  if (res && res.success) {
    showToast(`Farmer KYC status updated to ${status}`, 'success');
    loadAdminFarmers();
  } else {
    showToast(res?.message || 'Failed to update KYC status', 'error');
  }
}

async function loadAdminApplications() {
  const data = await apiCall('/farmer/applications/all', 'GET');
  if (data && data.success) {
    const apps = data.applications;
    document.getElementById('adminAppCount').textContent = apps.length;
    const tbody = document.getElementById('adminApplicationsTableBody');
    
    tbody.innerHTML = apps.map(app => {
      const rawAadhaar = app.userId?.aadhaar || '—';
      const formattedAadhaar = rawAadhaar.replace(/(\d{4})(?=\d)/g, '$1 ');
      const appliedDate = app.appliedAt ? new Date(app.appliedAt).toLocaleDateString('en-IN') : '—';
      
      const selectHtml = `
        <select onchange="updateAppStage('${app._id}', this.value)" style="padding:4px 8px;font-size:12px;width:auto">
          ${TIMELINE_STAGES.map((stageName, idx) => `
            <option value="${idx}" ${app.stageIndex === idx ? 'selected' : ''}>${stageName}</option>
          `).join('')}
        </select>
      `;

      return `
        <tr>
          <td><strong style="font-size:11px">${app._id.substring(18)}</strong></td>
          <td><strong>${app.farmerName}</strong><div style="font-size:11px;color:var(--muted)">Aadhaar: ${formattedAadhaar}</div></td>
          <td><strong>${app.schemeName}</strong></td>
          <td style="font-size:11px">${app.ministry}</td>
          <td>${appliedDate}</td>
          <td><span class="chip ${app.stageIndex === 3 ? 'chip-g' : app.stageIndex === 0 ? 'chip-o' : 'chip-b'}">${TIMELINE_STAGES[app.stageIndex] || 'Visited'}</span></td>
          <td>${selectHtml}</td>
        </tr>
      `;
    }).join('');
  }
}

async function updateAppStage(appId, newStageIndex) {
  const stageIdx = parseInt(newStageIndex);
  const statuses = ['visited', 'applied', 'under_review', 'approved_disbursed'];
  const newStatus = statuses[stageIdx];
  
  const res = await apiCall(`/farmer/applications/${appId}/status`, 'PUT', {
    status: newStatus,
    stageIndex: stageIdx,
    notes: `Stage updated by administrator to ${TIMELINE_STAGES[stageIdx]} on ${new Date().toLocaleDateString('en-IN')}`
  });

  if (res && res.success) {
    showToast(`Application stage updated to ${TIMELINE_STAGES[stageIdx]}`, 'success');
    loadAdminApplications();
  } else {
    showToast(res?.message || 'Failed to update application status', 'error');
  }
}

async function loadAdminAnalytics() {
  const farmersRes = await apiCall('/farmer/all', 'GET');
  const appsRes = await apiCall('/farmer/applications/all', 'GET');
  if (!farmersRes?.success || !appsRes?.success) return;
  
  const farmers = farmersRes.farmers;
  const applications = appsRes.applications;
  
  document.getElementById('statTotalFarmers').textContent = farmers.length;
  document.getElementById('statTotalApplications').textContent = applications.length;
  
  let disbursed = 0;
  applications.forEach(app => {
    if (app.stageIndex === 3) {
      const scheme = SCHEMES.find(s => s.id === app.schemeId);
      disbursed += (scheme?.maxBenefit || 0);
    }
  });
  document.getElementById('statApprovedAmount').textContent = `₹${disbursed.toLocaleString('en-IN')}`;
  
  const verifiedFarmers = farmers.filter(f => f.kycStatus === 'Verified').length;
  const kycRate = farmers.length > 0 ? Math.round((verifiedFarmers / farmers.length) * 100) : 0;
  document.getElementById('statKycCompletion').textContent = `${kycRate}%`;
  
  const distMap = {};
  farmers.forEach(f => {
    const dist = f.district || 'Unknown';
    distMap[dist] = (distMap[dist] || 0) + 1;
  });
  
  const stageMap = { 'Visited': 0, 'Applied': 0, 'Under Review': 0, 'Approved / Disbursed': 0 };
  applications.forEach(app => {
    const stageName = TIMELINE_STAGES[app.stageIndex] || 'Visited';
    stageMap[stageName] = (stageMap[stageName] || 0) + 1;
  });
  
  const maxDistCount = Math.max(...Object.values(distMap), 1);
  let distHtml = '';
  for (const [dist, count] of Object.entries(distMap)) {
    const pct = Math.round((count / maxDistCount) * 100);
    distHtml += `
      <div style="display:flex;align-items:center;font-size:12px;margin-bottom:8px">
        <div style="width:100px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${dist}</div>
        <div style="flex:1;background:var(--green-lt);height:16px;border-radius:8px;overflow:hidden;margin:0 10px">
          <div style="background:var(--green);width:${pct}%;height:100%;border-radius:8px;"></div>
        </div>
        <div style="width:30px;text-align:right;font-weight:700">${count}</div>
      </div>
    `;
  }
  document.getElementById('chartDistrictDistribution').innerHTML = distHtml || '<div style="color:var(--muted);text-align:center;padding:10px">No district data available</div>';
  
  const maxStageCount = Math.max(...Object.values(stageMap), 1);
  let stageHtml = '';
  for (const [stageName, count] of Object.entries(stageMap)) {
    const pct = Math.round((count / maxStageCount) * 100);
    stageHtml += `
      <div style="display:flex;align-items:center;font-size:12px;margin-bottom:8px">
        <div style="width:130px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${stageName}</div>
        <div style="flex:1;background:var(--saffron-lt);height:16px;border-radius:8px;overflow:hidden;margin:0 10px">
          <div style="background:var(--saffron);width:${pct}%;height:100%;border-radius:8px;"></div>
        </div>
        <div style="width:30px;text-align:right;font-weight:700">${count}</div>
      </div>
    `;
  }
  document.getElementById('chartStageDistribution').innerHTML = stageHtml || '<div style="color:var(--muted);text-align:center;padding:10px">No application data available</div>';
}

async function exportAnalyticsReport(format) {
  const farmersRes = await apiCall('/farmer/all', 'GET');
  const appsRes = await apiCall('/farmer/applications/all', 'GET');
  if (!farmersRes?.success || !appsRes?.success) {
    showToast('Failed to fetch data for report', 'error');
    return;
  }
  const farmers = farmersRes.farmers;
  const applications = appsRes.applications;
  
  let disbursed = 0;
  applications.forEach(app => {
    if (app.stageIndex === 3) {
      const scheme = SCHEMES.find(s => s.id === app.schemeId);
      disbursed += (scheme?.maxBenefit || 0);
    }
  });
  const verifiedFarmers = farmers.filter(f => f.kycStatus === 'Verified').length;
  const kycRate = farmers.length > 0 ? Math.round((verifiedFarmers / farmers.length) * 100) : 0;

  if (format === 'json') {
    const reportData = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalFarmers: farmers.length,
        totalApplications: applications.length,
        estimatedDisbursedAmount: disbursed,
        kycCompletionRate: `${kycRate}%`
      },
      farmers: farmers.map(f => ({
        name: f.name,
        aadhaar: f.userId?.aadhaar || '',
        district: f.district,
        taluka: f.taluka,
        income: f.income,
        category: f.category,
        kycStatus: f.kycStatus
      })),
      applications: applications.map(a => ({
        id: a._id,
        farmerName: a.farmerName,
        schemeName: a.schemeName,
        appliedAt: a.appliedAt,
        stageIndex: a.stageIndex,
        statusText: TIMELINE_STAGES[a.stageIndex] || 'Visited'
      }))
    };
    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('JSON report downloaded!', 'success');
  } else if (format === 'csv') {
    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Application ID,Farmer Name,Scheme Name,Ministry,Applied Date,Stage,Status\n';
    applications.forEach(a => {
      const appliedDate = a.appliedAt ? new Date(a.appliedAt).toLocaleDateString('en-IN') : '—';
      const stageName = TIMELINE_STAGES[a.stageIndex] || 'Visited';
      const row = [
        a._id,
        `"${a.farmerName.replace(/"/g, '""')}"`,
        `"${a.schemeName.replace(/"/g, '""')}"`,
        `"${a.ministry.replace(/"/g, '""')}"`,
        appliedDate,
        a.stageIndex,
        stageName
      ].join(',');
      csvContent += row + '\n';
    });
    const encodedUri = encodeURI(csvContent);
    const a = document.createElement('a');
    a.href = encodedUri;
    a.download = `applications-report-${Date.now()}.csv`;
    a.click();
    showToast('CSV report downloaded!', 'success');
  }
}
