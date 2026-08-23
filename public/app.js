// Global state
let trades = [];
let sheetConfig = null;
let charts = {};
let activeDashboardFilter = 'all';
let equityTimeframe = 'all';
let currentAccount = localStorage.getItem('njournal_active_account') || '1';

// Helper to parse floats that might contain commas
function parseLocalFloat(val) {
  if (val === undefined || val === null || val === '') return 0;
  const sanitized = String(val).replace(/,/g, '.').replace(/\s/g, '');
  const parsed = parseFloat(sanitized);
  return isNaN(parsed) ? 0 : parsed;
}

// Helper to get active account starting capital
function getActiveAccountCapital() {
  if (sheetConfig && sheetConfig.accounts && sheetConfig.accounts[currentAccount]) {
    return parseLocalFloat(sheetConfig.accounts[currentAccount].startingCapital) || 10000;
  }
  if (sheetConfig && sheetConfig.startingCapital) {
    return parseLocalFloat(sheetConfig.startingCapital) || 10000;
  }
  return 10000;
}

// Theme Selector logic
function changeTheme(themeName) {
  const link = document.getElementById('theme-stylesheet');
  if (!link) return;
  if (themeName === 'default') {
    link.href = 'index.css';
  } else {
    link.href = `themes/${themeName}.css`;
  }
  localStorage.setItem('njournal-theme', themeName);
  
  const select = document.getElementById('theme-select');
  if (select) {
    select.value = themeName;
  }
}

// Load saved theme on load
const savedTheme = localStorage.getItem('njournal-theme') || 'default';
changeTheme(savedTheme);

// Current active page
let currentPage = 'dashboard';

// DOM elements
const dashboardPage = document.getElementById('dashboard-page');
const tradesPage = document.getElementById('trades-page');
const settingsPage = document.getElementById('settings-page');

const navDashboard = document.getElementById('nav-dashboard');
const navTrades = document.getElementById('nav-trades');
const navSettings = document.getElementById('nav-settings');
const pageTitleText = document.getElementById('page-title');
const btnAddTradeHeader = document.getElementById('btn-add-trade-header');

// Connection status DOM
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// Modals
const tradeModal = document.getElementById('trade-modal');
const tradeForm = document.getElementById('trade-form');
const tradeIdField = document.getElementById('trade-id-field');

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('theme-select');
  if (select) {
    select.value = localStorage.getItem('njournal-theme') || 'default';
  }

  // Set default datetime to now
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localISOTime = new Date(now - offset).toISOString().slice(0, 16);
  const tradeDateInput = document.getElementById('trade-date');
  if (tradeDateInput) tradeDateInput.value = localISOTime;

  checkConfig();
});

// Switch Active Account (Akun 1, Akun 2, Akun 3)
async function switchAccount(accId) {
  currentAccount = String(accId);
  localStorage.setItem('njournal_active_account', currentAccount);
  
  // Update Header Pill Buttons
  ['1', '2', '3'].forEach(id => {
    const btn = document.getElementById(`btn-acc-${id}`);
    if (btn) {
      if (id === currentAccount) btn.classList.add('active');
      else btn.classList.remove('active');
    }
    const sideBtn = document.getElementById(`side-acc-${id}`);
    if (sideBtn) {
      if (id === currentAccount) {
        sideBtn.style.background = 'var(--primary)';
        sideBtn.style.color = '#000';
        sideBtn.style.border = 'none';
      } else {
        sideBtn.style.background = 'transparent';
        sideBtn.style.color = 'var(--text-secondary)';
        sideBtn.style.border = '1px solid var(--surface-border)';
      }
    }
  });
  
  // Update sidebar label
  const sideLabel = document.getElementById('sidebar-account-label');
  if (sideLabel) {
    const accName = sheetConfig && sheetConfig.accounts && sheetConfig.accounts[currentAccount] ? sheetConfig.accounts[currentAccount].name : `Akun ${currentAccount}`;
    sideLabel.innerText = accName;
  }
  
  // Update modal account select
  const modalSelect = document.getElementById('trade-account-select');
  if (modalSelect) {
    modalSelect.value = currentAccount;
  }
  
  showNotification(`Switched to Akun ${currentAccount}`, 'info');
  await fetchData();
}

// Show Notification toast
function showNotification(message, type = 'info') {
  const container = document.getElementById('notification-container');
  if (!container) return;
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  
  let icon = '';
  if (type === 'success') {
    icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  } else if (type === 'error') {
    icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
  } else {
    icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  notification.innerHTML = `
    ${icon}
    <span>${message}</span>
  `;
  
  container.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 4000);
}

function copySettingsServiceEmail() {
  const text = document.getElementById('settings-service-email').innerText;
  navigator.clipboard.writeText(text).then(() => {
    showNotification('Email copied to clipboard!', 'success');
  }).catch(() => {
    showNotification('Failed to copy email', 'error');
  });
}

// Check if configuration exists
async function checkConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    sheetConfig = data;
    
    // Set email in Settings panel
    document.getElementById('settings-service-email').innerText = data.serviceAccountEmail || 'None';
    
    if (data.connected && data.spreadsheetId) {
      statusDot.className = 'status-dot connected';
      statusText.innerText = 'Connected';
    } else {
      statusDot.className = 'status-dot disconnected';
      statusText.innerText = 'Disconnected';
    }
    
    // Update settings form values
    document.getElementById('settings-spreadsheet-id').value = data.spreadsheetId || '';
    
    // Populate multi-account form fields in Settings
    if (data.accounts) {
      for (const id of ['1', '2', '3']) {
        const acc = data.accounts[id] || {};
        const nameEl = document.getElementById(`acc-name-${id}`);
        const sheetEl = document.getElementById(`acc-sheet-${id}`);
        const capEl = document.getElementById(`acc-capital-${id}`);
        if (nameEl) nameEl.value = acc.name || `Akun ${id}`;
        if (sheetEl) sheetEl.value = acc.sheetName || (id === '1' ? 'Trades' : `Akun ${id}`);
        if (capEl) capEl.value = acc.startingCapital !== undefined ? acc.startingCapital : 10000;
      }
    }
    
    // Sync active account
    switchAccount(currentAccount);
    
    btnAddTradeHeader.style.display = 'inline-flex';
    switchPage('dashboard');
  } catch (err) {
    console.error('Error checking config:', err);
    showNotification('Backend server connection failed. Please start your server.', 'error');
  }
}

// Save Settings (from settings panel)
async function saveSettings(e) {
  e.preventDefault();
  const spreadsheetId = document.getElementById('settings-spreadsheet-id').value.trim();
  
  const accounts = {
    "1": {
      name: document.getElementById('acc-name-1').value.trim() || 'Akun 1',
      sheetName: document.getElementById('acc-sheet-1').value.trim() || 'Trades',
      startingCapital: parseLocalFloat(document.getElementById('acc-capital-1').value) || 10000
    },
    "2": {
      name: document.getElementById('acc-name-2').value.trim() || 'Akun 2',
      sheetName: document.getElementById('acc-sheet-2').value.trim() || 'Akun 2',
      startingCapital: parseLocalFloat(document.getElementById('acc-capital-2').value) || 10000
    },
    "3": {
      name: document.getElementById('acc-name-3').value.trim() || 'Akun 3',
      sheetName: document.getElementById('acc-sheet-3').value.trim() || 'Akun 3',
      startingCapital: parseLocalFloat(document.getElementById('acc-capital-3').value) || 10000
    }
  };
  
  showNotification('Saving multi-account settings...', 'info');
  
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spreadsheetId, accounts, currentAccount })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showNotification('Multi-Account configuration saved successfully!', 'success');
      await checkConfig();
    } else {
      showNotification(data.error || 'Failed to save settings', 'error');
    }
  } catch (err) {
    showNotification('Failed to contact backend server', 'error');
  }
}

// Disconnect sheet
async function disconnectSheet() {
  if (!confirm('Are you sure you want to disconnect your Google Sheet?')) return;
  
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spreadsheetId: ' ' })
    });
    window.location.reload();
  } catch (err) {
    showNotification('Failed to disconnect', 'error');
  }
}

// Auto Initialize Sheet Structure for all accounts
async function initializeSheetStructure() {
  if (!sheetConfig || !sheetConfig.spreadsheetId) {
    showNotification('Spreadsheet ID is not configured!', 'warning');
    return;
  }
  
  showNotification('Initializing Google Sheet tabs (Akun 1, 2, 3)...', 'info');
  try {
    const res = await fetch('/api/init-sheet', { method: 'POST' });
    const data = await res.json();
    
    if (res.ok && data.success) {
      showNotification('All account sheets formatted & initialized successfully!', 'success');
    } else {
      showNotification(data.error || 'Failed to initialize spreadsheet', 'error');
    }
  } catch (err) {
    showNotification('Failed to format Google Sheet', 'error');
  }
}

// Fetch Trade Data for Active Account
async function fetchData() {
  if (!sheetConfig || !sheetConfig.spreadsheetId) return;
  
  showNotification(`Loading trades for Akun ${currentAccount}...`, 'info');
  try {
    const res = await fetch(`/api/trades?account=${currentAccount}`);
    const data = await res.json();
    
    if (res.ok) {
      trades = data.trades || [];
      showNotification(`Trades for Akun ${currentAccount} loaded!`, 'success');
      
      populateRecentTradesTable();
      updateStatsAndCharts();
      populateTradesTable();
      populateSetupFilters();
    } else {
      showNotification(data.error || 'Failed to load trades', 'error');
    }
  } catch (err) {
    console.error('Fetch trades error:', err);
    showNotification('Failed to load data from backend server', 'error');
  }
}

// Navigation / Switch Page
function switchPage(page) {
  currentPage = page;
  
  dashboardPage.classList.remove('active');
  tradesPage.classList.remove('active');
  settingsPage.classList.remove('active');
  
  navDashboard.classList.remove('active');
  navTrades.classList.remove('active');
  navSettings.classList.remove('active');
  
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && overlay) {
    sidebar.classList.remove('active-mobile');
    overlay.classList.remove('active-mobile');
  }
  
  if (page === 'dashboard') {
    dashboardPage.classList.add('active');
    navDashboard.classList.add('active');
    pageTitleText.innerText = 'Dashboard';
    updateStatsAndCharts();
  } else if (page === 'trades') {
    tradesPage.classList.add('active');
    navTrades.classList.add('active');
    pageTitleText.innerText = 'Trades Log';
    populateTradesTable();
    populateSetupFilters();
  } else if (page === 'settings') {
    settingsPage.classList.add('active');
    navSettings.classList.add('active');
    pageTitleText.innerText = 'Google Sheets Settings';
  }
}

// Format numbers
function formatCurrency(val) {
  const isNeg = val < 0;
  const absVal = Math.abs(val);
  return `${isNeg ? '-' : ''}$${absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(val) {
  const isNeg = val < 0;
  const absVal = Math.abs(val);
  return `${isNeg ? '-' : '+'}${absVal.toFixed(2)}%`;
}

// Modal Handlers
function openAddTradeModal() {
  tradeForm.reset();
  tradeIdField.value = '';
  document.getElementById('modal-title').innerText = 'Add New Trade';
  document.getElementById('btn-save-trade').innerText = 'Save Trade';
  
  const accountSelect = document.getElementById('trade-account-select');
  if (accountSelect) accountSelect.value = currentAccount;

  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localISOTime = new Date(now - offset).toISOString().slice(0, 16);
  document.getElementById('trade-date').value = localISOTime;
  
  toggleExitField();
  tradeModal.classList.add('active');
}

function closeTradeModal() {
  tradeModal.classList.remove('active');
}

function toggleExitField() {
  const status = document.getElementById('trade-status').value;
  const exitGroup = document.getElementById('exit-price-group');
  const exitInput = document.getElementById('trade-exit');
  
  if (status === 'Open') {
    exitGroup.style.opacity = '0.5';
    exitInput.required = false;
  } else {
    exitGroup.style.opacity = '1';
    exitInput.required = true;
  }
}

// Edit Trade Modal Open
function openEditTradeModal(id) {
  const trade = trades.find(t => t.id === id);
  if (!trade) return;
  
  document.getElementById('modal-title').innerText = 'Edit Trade';
  document.getElementById('btn-save-trade').innerText = 'Update Trade';
  tradeIdField.value = trade.id;
  
  const accountSelect = document.getElementById('trade-account-select');
  if (accountSelect) accountSelect.value = currentAccount;

  if (trade.date) {
    const d = trade.date.replace(' ', 'T').slice(0, 16);
    document.getElementById('trade-date').value = d;
  }
  
  document.getElementById('trade-ticker').value = trade.ticker || '';
  document.getElementById('trade-action').value = trade.action || 'Long';
  document.getElementById('trade-status').value = trade.status || 'Open';
  document.getElementById('trade-setup').value = trade.setup || '';
  document.getElementById('trade-entry').value = trade.entryPrice || '';
  document.getElementById('trade-exit').value = trade.exitPrice || '';
  document.getElementById('trade-size').value = trade.size || '';
  document.getElementById('trade-fees').value = trade.fees || '0.00';
  document.getElementById('trade-pnl-input').value = trade.pnl !== null && trade.pnl !== undefined ? trade.pnl : '';
  document.getElementById('trade-notes').value = trade.notes || '';
  
  toggleExitField();
  tradeModal.classList.add('active');
}

// Filter dashboard by quick timeframe range (Today, Week, Month, All)
function filterDashboardRange(range) {
  activeDashboardFilter = range;
  
  ['today', 'week', 'month', 'all'].forEach(r => {
    const btn = document.getElementById(`db-f-${r}`);
    if (btn) {
      if (r === range) {
        btn.style.background = 'var(--primary)';
        btn.style.color = '#000';
      } else {
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text-secondary)';
      }
    }
  });
  
  updateStatsAndCharts();
}

// Filter equity chart by timeframe
function filterEquityByTimeframe(timeframe) {
  equityTimeframe = timeframe;
  
  ['1D', '1W', '1M', 'all'].forEach(tf => {
    const btn = document.getElementById(`tf-${tf}`);
    if (btn) {
      if (tf === timeframe) {
        btn.style.background = 'var(--primary)';
        btn.style.color = '#000';
      } else {
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text-secondary)';
      }
    }
  });
  
  updateStatsAndCharts();
}

// Populate Recent Trades Mini-Table
function populateRecentTradesTable() {
  const tbody = document.getElementById('recent-trades-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  const sorted = [...trades]
    .filter(t => t.ticker)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);
    
  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No trades recorded for this account</td></tr>';
    return;
  }
  
  sorted.forEach(trade => {
    const tr = document.createElement('tr');
    
    let statusClass = 'badge-open';
    if (trade.status === 'Won') statusClass = 'badge-won';
    else if (trade.status === 'Lost') statusClass = 'badge-lost';
    else if (trade.status === 'Breakeven') statusClass = 'badge-breakeven';
    
    const statusBadge = `<span class="badge ${statusClass}">${trade.status}</span>`;
    const actionBadge = `<span class="badge ${trade.action === 'Long' ? 'badge-long' : 'badge-short'}">${trade.action}</span>`;
    
    let pnlClass = 'text-neutral';
    let formattedPnl = '-';
    if (trade.status !== 'Open') {
      pnlClass = trade.pnl > 0 ? 'text-profit' : (trade.pnl < 0 ? 'text-loss' : 'text-neutral');
      formattedPnl = formatCurrency(trade.pnl);
    }
    
    tr.innerHTML = `
      <td style="font-family: var(--font-mono); font-size: 0.75rem; padding: 12px 16px;">${trade.date ? trade.date.split(' ')[0] : '-'}</td>
      <td style="padding: 12px 16px;"><strong>${trade.ticker}</strong></td>
      <td style="padding: 12px 16px;">${actionBadge}</td>
      <td style="font-family: var(--font-mono); padding: 12px 16px;">${trade.size}</td>
      <td class="${pnlClass}" style="font-family: var(--font-mono); font-weight: 700; padding: 12px 16px;">${formattedPnl}</td>
      <td style="padding: 12px 16px;">${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Render Daily Net PnL Bar Chart (Last 7 Days)
function renderDailyNetPnlChart(closedTrades) {
  const ctx = document.getElementById('dailyNetPnlChart').getContext('2d');
  const styles = getChartStyles();
  
  const last7Days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    last7Days.push({
      dateStr,
      displayDate: d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
      pnl: 0
    });
  }
  
  closedTrades.forEach(t => {
    if (t.date) {
      const tradeDate = t.date.split(' ')[0];
      const match = last7Days.find(d => d.dateStr === tradeDate);
      if (match) {
        match.pnl += t.pnl;
      }
    }
  });
  
  const labels = last7Days.map(d => d.displayDate);
  const data = last7Days.map(d => Math.round(d.pnl * 100) / 100);
  const backgroundColors = data.map(v => v >= 0 ? '#10b981' : '#f43f5e');
  
  if (charts.dailyNetPnl) {
    charts.dailyNetPnl.destroy();
  }
  
  charts.dailyNetPnl = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Net P&L',
        data,
        backgroundColor: backgroundColors,
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: styles.tooltipBg,
          borderColor: styles.tooltipBorder,
          borderWidth: 1,
          callbacks: {
            label: (ctx) => `Net P&L: ${ctx.parsed.y >= 0 ? '+' : ''}${formatCurrency(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: styles.textColor, font: { family: 'Inter', size: 10 } }
        },
        y: {
          grid: { color: styles.gridColor },
          ticks: {
            color: styles.textColor,
            font: { family: 'Inter', size: 10 },
            callback: (val) => `$${val}`
          }
        }
      }
    }
  });
}

// Save or Update Trade Form Submit
async function saveTrade(e) {
  e.preventDefault();
  
  const id = tradeIdField.value;
  const isEdit = !!id;
  
  const rawDate = document.getElementById('trade-date').value;
  const dateFormatted = rawDate ? rawDate.replace('T', ' ') : '';
  
  const targetAccount = document.getElementById('trade-account-select') ? document.getElementById('trade-account-select').value : currentAccount;
  
  const pnlInputVal = document.getElementById('trade-pnl-input').value.trim();
  const tradeData = {
    account: targetAccount,
    date: dateFormatted,
    ticker: document.getElementById('trade-ticker').value.trim().toUpperCase(),
    action: document.getElementById('trade-action').value,
    status: document.getElementById('trade-status').value,
    setup: document.getElementById('trade-setup').value.trim(),
    entryPrice: parseLocalFloat(document.getElementById('trade-entry').value) || 0,
    exitPrice: parseLocalFloat(document.getElementById('trade-exit').value) || 0,
    size: parseLocalFloat(document.getElementById('trade-size').value) || 0,
    fees: parseLocalFloat(document.getElementById('trade-fees').value) || 0,
    pnl: pnlInputVal !== '' ? parseLocalFloat(pnlInputVal) : null,
    notes: document.getElementById('trade-notes').value.trim()
  };
  
  showNotification(isEdit ? 'Updating trade...' : 'Adding trade...', 'info');
  
  try {
    const url = isEdit ? `/api/trades/${id}` : '/api/trades';
    const method = isEdit ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tradeData)
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showNotification(isEdit ? 'Trade updated successfully!' : 'Trade added successfully!', 'success');
      closeTradeModal();
      
      if (targetAccount !== currentAccount) {
        switchAccount(targetAccount);
      } else {
        await fetchData();
      }
    } else {
      showNotification(data.error || 'Failed to save trade', 'error');
    }
  } catch (err) {
    showNotification('Network error while saving trade', 'error');
  }
}

// Delete Trade
async function deleteTrade(id) {
  if (!confirm('Are you sure you want to delete this trade from Google Sheet?')) return;
  
  showNotification('Deleting trade...', 'info');
  try {
    const res = await fetch(`/api/trades/${id}?account=${currentAccount}`, {
      method: 'DELETE'
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showNotification('Trade deleted successfully!', 'success');
      await fetchData();
    } else {
      showNotification(data.error || 'Failed to delete trade', 'error');
    }
  } catch (err) {
    showNotification('Network error while deleting trade', 'error');
  }
}

// Populate filters dynamically
function populateSetupFilters() {
  const filterSetup = document.getElementById('filter-setup');
  if (!filterSetup) return;
  filterSetup.innerHTML = '<option value="ALL">All Strategies</option>';
  
  const setups = [...new Set(trades.map(t => t.setup).filter(Boolean))];
  setups.forEach(setup => {
    const option = document.createElement('option');
    option.value = setup;
    option.innerText = setup;
    filterSetup.appendChild(option);
  });
}

// Apply table filters
function applyFilters() {
  const searchTicker = document.getElementById('search-ticker').value.trim().toUpperCase();
  const filterStatus = document.getElementById('filter-status').value;
  const filterAction = document.getElementById('filter-action').value;
  const filterSetup = document.getElementById('filter-setup').value;
  
  const filtered = trades.filter(trade => {
    const matchTicker = !searchTicker || (trade.ticker && trade.ticker.includes(searchTicker));
    const matchStatus = filterStatus === 'ALL' || trade.status === filterStatus;
    const matchAction = filterAction === 'ALL' || trade.action === filterAction;
    const matchSetup = filterSetup === 'ALL' || trade.setup === filterSetup;
    
    return matchTicker && matchStatus && matchAction && matchSetup;
  });
  
  renderTradesTableRows(filtered);
}

// Populate Trades Log Table
function populateTradesTable() {
  renderTradesTableRows(trades);
}

function renderTradesTableRows(tradeList) {
  const tbody = document.getElementById('trades-tbody');
  const emptyState = document.getElementById('table-empty-state');
  
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (tradeList.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  
  if (emptyState) emptyState.style.display = 'none';
  
  const sorted = [...tradeList].sort((a, b) => new Date(b.date) - new Date(a.date));
  
  sorted.forEach(trade => {
    const tr = document.createElement('tr');
    
    let statusClass = 'badge-open';
    if (trade.status === 'Won') statusClass = 'badge-won';
    else if (trade.status === 'Lost') statusClass = 'badge-lost';
    else if (trade.status === 'Breakeven') statusClass = 'badge-breakeven';
    
    const statusBadge = `<span class="badge ${statusClass}">${trade.status}</span>`;
    const actionBadge = `<span class="badge ${trade.action === 'Long' ? 'badge-long' : 'badge-short'}">${trade.action}</span>`;
    
    let pnlClass = 'text-neutral';
    let formattedPnl = '-';
    let formattedRoi = '-';
    
    if (trade.status !== 'Open') {
      pnlClass = trade.pnl > 0 ? 'text-profit' : (trade.pnl < 0 ? 'text-loss' : 'text-neutral');
      formattedPnl = formatCurrency(trade.pnl);
      formattedRoi = formatPercent(trade.roi);
    }
    
    tr.innerHTML = `
      <td style="font-family: var(--font-mono); font-size: 0.8rem;">${trade.date || '-'}</td>
      <td><strong>${trade.ticker}</strong></td>
      <td>${actionBadge}</td>
      <td style="font-family: var(--font-mono);">${formatCurrency(trade.entryPrice)}</td>
      <td style="font-family: var(--font-mono);">${trade.status === 'Open' ? '-' : formatCurrency(trade.exitPrice)}</td>
      <td style="font-family: var(--font-mono);">${trade.size}</td>
      <td style="font-family: var(--font-mono);">${formatCurrency(trade.fees)}</td>
      <td class="${pnlClass}" style="font-family: var(--font-mono); font-weight: 700;">${formattedPnl}</td>
      <td class="${pnlClass}" style="font-family: var(--font-mono);">${formattedRoi}</td>
      <td><span class="badge badge-strategy">${trade.setup || 'General'}</span></td>
      <td>${statusBadge}</td>
      <td style="text-align: right;">
        <div class="action-buttons">
          <button class="btn-icon" onclick="openEditTradeModal('${trade.id}')" title="Edit Trade">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="btn-icon delete" onclick="deleteTrade('${trade.id}')" title="Delete Trade">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Extract Styles from Active Theme CSS Variables
function getChartStyles() {
  const root = getComputedStyle(document.documentElement);
  return {
    primaryColor: root.getPropertyValue('--primary').trim() || '#14b8a6',
    primaryGlow: root.getPropertyValue('--primary-glow').trim() || 'rgba(20, 184, 166, 0.12)',
    successColor: '#10b981',
    dangerColor: '#f43f5e',
    warningColor: '#fbbf24',
    textColor: root.getPropertyValue('--text-muted').trim() || '#94a3b8',
    gridColor: 'rgba(255, 255, 255, 0.05)',
    tooltipBg: 'rgba(9, 13, 26, 0.95)',
    tooltipBorder: 'rgba(255, 255, 255, 0.1)'
  };
}

// Calculate Statistics and Render Charts
function updateStatsAndCharts() {
  const styles = getChartStyles();
  
  let filteredTrades = [...trades];
  const now = new Date();
  
  if (activeDashboardFilter === 'today') {
    const todayStr = now.toISOString().split('T')[0];
    filteredTrades = trades.filter(t => t.date && t.date.startsWith(todayStr));
  } else if (activeDashboardFilter === 'week') {
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    startOfWeek.setHours(0, 0, 0, 0);
    
    filteredTrades = trades.filter(t => {
      if (!t.date) return false;
      const tradeDate = new Date(t.date.replace(' ', 'T'));
      return tradeDate >= startOfWeek;
    });
  } else if (activeDashboardFilter === 'month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    filteredTrades = trades.filter(t => {
      if (!t.date) return false;
      const tradeDate = new Date(t.date.replace(' ', 'T'));
      return tradeDate >= startOfMonth;
    });
  }
  
  const closedTrades = filteredTrades.filter(t => t.status !== 'Open');
  const openTrades = filteredTrades.filter(t => t.status === 'Open');
  
  const totalClosed = closedTrades.length;
  const wonTrades = closedTrades.filter(t => t.status === 'Won');
  const lostTrades = closedTrades.filter(t => t.status === 'Lost');
  const breakevenTrades = closedTrades.filter(t => t.status === 'Breakeven');
  
  const totalWins = wonTrades.length;
  const totalLosses = lostTrades.length;
  const totalBreakeven = breakevenTrades.length;
  
  const winRate = totalClosed > 0 ? (totalWins / totalClosed) * 100 : 0;
  
  const netPnl = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
  const winSum = wonTrades.reduce((sum, t) => sum + t.pnl, 0);
  const lossSum = Math.abs(lostTrades.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = lossSum > 0 ? winSum / lossSum : (winSum > 0 ? winSum : 0);
  
  const avgTradeRoi = totalClosed > 0 ? closedTrades.reduce((sum, t) => sum + t.roi, 0) / totalClosed : 0;
  
  const startingCapital = getActiveAccountCapital();
  
  const avgWin = totalWins > 0 ? winSum / totalWins : 0;
  const avgLoss = totalLosses > 0 ? lossSum / totalLosses : 0;
  
  const allTimeClosedTrades = trades.filter(t => t.status !== 'Open');
  const allTimeNetPnl = allTimeClosedTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalBalance = startingCapital + allTimeNetPnl;
  const accountRoi = startingCapital > 0 ? (allTimeNetPnl / startingCapital) * 100 : 0;
  
  document.getElementById('hero-total-balance').innerText = formatCurrency(totalBalance);
  
  const heroPnlPill = document.getElementById('hero-pnl-pill');
  const heroPnlText = document.getElementById('hero-pnl-text');
  heroPnlText.innerText = `${netPnl >= 0 ? '+' : ''}${formatCurrency(netPnl)}`;
  if (netPnl > 0) {
    heroPnlPill.className = 'hero-pnl-pill positive';
  } else if (netPnl < 0) {
    heroPnlPill.className = 'hero-pnl-pill negative';
  } else {
    heroPnlPill.className = 'hero-pnl-pill';
  }
  
  const heroRoiEl = document.getElementById('hero-account-roi');
  heroRoiEl.innerText = formatPercent(accountRoi);
  heroRoiEl.className = `meta-val ${accountRoi >= 0 ? 'positive' : 'negative'}`;
  
  document.getElementById('hero-win-rate').innerText = `${Math.round(winRate)}%`;
  document.getElementById('hero-total-trades').innerText = filteredTrades.length;
  
  const netPnlEl = document.getElementById('stat-net-pnl');
  netPnlEl.innerText = formatCurrency(netPnl);
  netPnlEl.className = `stat-value ${netPnl > 0 ? 'text-profit' : (netPnl < 0 ? 'text-loss' : 'text-neutral')}`;
  
  const avgRoiEl = document.getElementById('stat-avg-trade-roi');
  avgRoiEl.innerText = `${formatPercent(avgTradeRoi)} Avg. Trade ROI`;
  
  document.getElementById('stat-win-loss-ratio-val').innerText = `${totalWins}W - ${totalLosses}L`;
  document.getElementById('stat-win-loss-ratio').innerText = `${totalBreakeven} Breakevens`;
  
  document.getElementById('stat-profit-factor').innerText = profitFactor.toFixed(2);
  document.getElementById('stat-avg-win-loss').innerText = `Avg Win: $${Math.round(avgWin)} / Loss: $${Math.round(avgLoss)}`;
  
  document.getElementById('stat-open-trades-val').innerText = openTrades.length;
  document.getElementById('stat-open-trades-ratio').innerText = `${openTrades.length} Open of ${filteredTrades.length} Total`;
  
  renderEquityChart(closedTrades);
  renderWinLossChart(totalWins, totalLosses, totalBreakeven);
  renderStrategyChart(closedTrades);
  renderDayChart(closedTrades);
  renderDailyNetPnlChart(closedTrades);
}

// Chart: Equity Curve
function renderEquityChart(closedTrades) {
  const ctx = document.getElementById('equityChart').getContext('2d');
  const styles = getChartStyles();
  
  let sorted = [...closedTrades].sort((a, b) => new Date(a.date) - new Date(b.date));
  
  const now = new Date();
  if (equityTimeframe === '1D') {
    const todayStr = now.toISOString().split('T')[0];
    sorted = sorted.filter(t => t.date && t.date.startsWith(todayStr));
  } else if (equityTimeframe === '1W') {
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    startOfWeek.setHours(0, 0, 0, 0);
    sorted = sorted.filter(t => t.date && new Date(t.date.replace(' ', 'T')) >= startOfWeek);
  } else if (equityTimeframe === '1M') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    sorted = sorted.filter(t => t.date && new Date(t.date.replace(' ', 'T')) >= startOfMonth);
  }
  
  const startingCapital = getActiveAccountCapital();
  
  const labels = ['Start'];
  const data = [startingCapital];
  let runningBalance = startingCapital;
  
  sorted.forEach((trade, idx) => {
    runningBalance += trade.pnl;
    labels.push(`#${idx + 1}`);
    data.push(Math.round(runningBalance * 100) / 100);
  });
  
  if (charts.equity) {
    charts.equity.destroy();
  }
  
  const isUp = runningBalance >= startingCapital;
  const strokeColor = isUp ? '#14b8a6' : '#f43f5e';
  
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, isUp ? 'rgba(20, 184, 166, 0.25)' : 'rgba(244, 63, 94, 0.25)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  
  charts.equity = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: strokeColor,
        borderWidth: 2.5,
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: strokeColor,
        pointBorderColor: '#0c0d14',
        pointBorderWidth: 1.5,
        pointRadius: data.length > 30 ? 0 : 3.5,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: styles.tooltipBg,
          borderColor: styles.tooltipBorder,
          borderWidth: 1,
          titleColor: '#fff',
          bodyColor: '#e2e8f0',
          displayColors: false,
          padding: 10,
          callbacks: {
            title: function(context) {
              const idx = context[0].dataIndex;
              if (idx === 0) return 'Initial Balance';
              const trade = sorted[idx - 1];
              return `${trade.ticker} (${trade.action})`;
            },
            label: function(context) {
              const idx = context.dataIndex;
              const lines = [`Balance: ${formatCurrency(context.parsed.y)}`];
              if (idx > 0) {
                const trade = sorted[idx - 1];
                lines.push(`PnL: ${trade.pnl >= 0 ? '+' : ''}${formatCurrency(trade.pnl)} (${formatPercent(trade.roi)})`);
                lines.push(`Date: ${trade.date ? trade.date.split(' ')[0] : '-'}`);
              }
              return lines;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: styles.textColor,
            font: { family: 'Inter', size: 10 },
            maxRotation: 0,
            minRotation: 0
          }
        },
        y: {
          grid: { color: styles.gridColor },
          ticks: {
            color: styles.textColor,
            font: { family: 'Inter', size: 10 },
            callback: (val) => `$${val}`
          }
        }
      }
    }
  });
}

// Chart: Win / Loss Donut
function renderWinLossChart(wins, losses, breakeven) {
  const ctx = document.getElementById('winLossChart').getContext('2d');
  const styles = getChartStyles();
  
  if (charts.winLoss) {
    charts.winLoss.destroy();
  }
  
  const total = wins + losses + breakeven;
  const winPercent = total > 0 ? Math.round((wins / total) * 100) : 0;
  
  const centerTextPlugin = {
    id: 'centerText',
    beforeDraw: function(chart) {
      const width = chart.width;
      const height = chart.height;
      const ctx = chart.ctx;
      
      ctx.restore();
      ctx.font = '800 1.6rem Inter, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      
      const textX = width / 2;
      const textY = (height / 2) - 8;
      ctx.fillText(`${winPercent}%`, textX, textY);
      
      ctx.font = '600 0.7rem Inter, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('WIN RATE', textX, textY + 22);
      ctx.save();
    }
  };
  
  charts.winLoss = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Won', 'Lost', 'Breakeven'],
      datasets: [{
        data: total > 0 ? [wins, losses, breakeven] : [1, 0, 0],
        backgroundColor: total > 0 
          ? ['#10b981', '#f43f5e', '#fbbf24']
          : ['rgba(255, 255, 255, 0.05)', 'transparent', 'transparent'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '76%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: styles.textColor,
            font: { family: 'Inter', size: 11 },
            usePointStyle: true,
            padding: 16
          }
        },
        tooltip: {
          backgroundColor: styles.tooltipBg,
          borderColor: styles.tooltipBorder,
          borderWidth: 1,
          enabled: total > 0
        }
      }
    },
    plugins: [centerTextPlugin]
  });
}

// Chart: Strategy Performance
function renderStrategyChart(closedTrades) {
  const ctx = document.getElementById('strategyChart').getContext('2d');
  const styles = getChartStyles();
  
  const strategyMap = {};
  closedTrades.forEach(trade => {
    const setup = trade.setup || 'General';
    if (!strategyMap[setup]) {
      strategyMap[setup] = 0;
    }
    strategyMap[setup] += trade.pnl;
  });
  
  const labels = Object.keys(strategyMap);
  const data = Object.values(strategyMap).map(v => Math.round(v * 100) / 100);
  const backgroundColors = data.map(v => v >= 0 ? '#10b981' : '#f43f5e');
  
  if (charts.strategy) {
    charts.strategy.destroy();
  }
  
  charts.strategy = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length > 0 ? labels : ['No Setups'],
      datasets: [{
        label: 'Net P&L ($)',
        data: data.length > 0 ? data : [0],
        backgroundColor: backgroundColors.length > 0 ? backgroundColors : ['rgba(255, 255, 255, 0.1)'],
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: styles.tooltipBg,
          borderColor: styles.tooltipBorder,
          borderWidth: 1,
          callbacks: {
            label: (ctx) => `Net P&L: ${ctx.parsed.y >= 0 ? '+' : ''}${formatCurrency(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: styles.textColor, font: { family: 'Inter', size: 10 } }
        },
        y: {
          grid: { color: styles.gridColor },
          ticks: {
            color: styles.textColor,
            font: { family: 'Inter', size: 10 },
            callback: (val) => `$${val}`
          }
        }
      }
    }
  });
}

// Chart: Day of Week Performance
function renderDayChart(closedTrades) {
  const ctx = document.getElementById('dayChart').getContext('2d');
  const styles = getChartStyles();
  
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayPnl = [0, 0, 0, 0, 0, 0, 0];
  
  closedTrades.forEach(trade => {
    if (trade.date) {
      const d = new Date(trade.date.replace(' ', 'T'));
      if (!isNaN(d.getDay())) {
        dayPnl[d.getDay()] += trade.pnl;
      }
    }
  });
  
  const tradingDays = [1, 2, 3, 4, 5];
  const labels = tradingDays.map(i => days[i]);
  const data = tradingDays.map(i => Math.round(dayPnl[i] * 100) / 100);
  const backgroundColors = data.map(v => v >= 0 ? '#10b981' : '#f43f5e');
  
  if (charts.day) {
    charts.day.destroy();
  }
  
  charts.day = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Net P&L ($)',
        data,
        backgroundColor: backgroundColors,
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: styles.tooltipBg,
          borderColor: styles.tooltipBorder,
          borderWidth: 1,
          callbacks: {
            label: (ctx) => `Net P&L: ${ctx.parsed.y >= 0 ? '+' : ''}${formatCurrency(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: styles.textColor, font: { family: 'Inter', size: 10 } }
        },
        y: {
          grid: { color: styles.gridColor },
          ticks: {
            color: styles.textColor,
            font: { family: 'Inter', size: 10 },
            callback: (val) => `$${val}`
          }
        }
      }
    }
  });
}

// Adjust Starting Capital dynamically for Active Account
async function adjustStartingCapital(action) {
  if (!sheetConfig || !sheetConfig.spreadsheetId) {
    showNotification('Silakan hubungkan Google Spreadsheet ID terlebih dahulu.', 'warning');
    return;
  }
  
  const currentCapital = getActiveAccountCapital();
  const promptText = action === 'add' 
    ? `Masukkan nominal yang ingin DITAMBAHKAN ke Saldo Awal Akun ${currentAccount}:` 
    : `Masukkan nominal yang ingin DIKURANGI dari Saldo Awal Akun ${currentAccount}:`;
    
  const input = prompt(promptText, '0');
  if (input === null) return;
  
  const amount = parseLocalFloat(input);
  if (isNaN(amount) || amount <= 0) {
    showNotification('Nominal harus berupa angka lebih dari 0.', 'warning');
    return;
  }
  
  let newCapital = currentCapital;
  if (action === 'add') {
    newCapital += amount;
  } else {
    if (amount > currentCapital) {
      if (!confirm(`Peringatan: Nominal pengurangan ($${amount}) lebih besar dari Saldo Awal saat ini ($${currentCapital}). Lanjutkan?`)) {
        return;
      }
    }
    newCapital -= amount;
  }
  
  showNotification(`Memproses penyesuaian saldo Akun ${currentAccount}...`, 'info');
  
  try {
    const accSheet = sheetConfig && sheetConfig.accounts && sheetConfig.accounts[currentAccount] ? sheetConfig.accounts[currentAccount].sheetName : (currentAccount === '1' ? 'Trades' : `Akun ${currentAccount}`);
    
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        spreadsheetId: sheetConfig.spreadsheetId, 
        accountId: currentAccount,
        sheetName: accSheet, 
        startingCapital: newCapital 
      })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showNotification(`Saldo awal Akun ${currentAccount} berhasil di-${action === 'add' ? 'tambah' : 'kurangi'}!`, 'success');
      await checkConfig();
    } else {
      showNotification(data.error || 'Gagal menyesuaikan saldo', 'error');
    }
  } catch (err) {
    showNotification('Gagal terhubung ke server', 'error');
  }
}

// Toggle mobile sidebar drawer
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && overlay) {
    sidebar.classList.toggle('active-mobile');
    overlay.classList.toggle('active-mobile');
  }
}
