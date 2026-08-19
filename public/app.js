// Global state
let trades = [];
let sheetConfig = null;
let charts = {};
let activeDateFilter = 'all';

// Helper to parse floats that might contain commas
function parseLocalFloat(val) {
  if (val === undefined || val === null || val === '') return 0;
  const sanitized = String(val).replace(/,/g, '.').replace(/\s/g, '');
  const parsed = parseFloat(sanitized);
  return isNaN(parsed) ? 0 : parsed;
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
  
  // Set select input value if it exists
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
  // Sync theme selector dropdown value
  const select = document.getElementById('theme-select');
  if (select) {
    select.value = localStorage.getItem('njournal-theme') || 'default';
  }

  // Set default datetime to now
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localISOTime = new Date(now - offset).toISOString().slice(0, 16);
  document.getElementById('trade-date').value = localISOTime;

  checkConfig();
});

// Show Notification toast
function showNotification(message, type = 'info') {
  const container = document.getElementById('notification-container');
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
  
  // Trigger animation reflow
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  // Remove after 4 seconds
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
    document.getElementById('settings-sheet-name').value = data.sheetName || 'Trades';
    document.getElementById('settings-starting-capital').value = data.startingCapital || 10000;
    
    btnAddTradeHeader.style.display = 'inline-flex';
    
    // Always load dashboard and fetch data
    switchPage('dashboard');
    await fetchData();
  } catch (err) {
    console.error('Error checking config:', err);
    showNotification('Backend server connection failed. Please start your server.', 'error');
  }
}

// Save Settings (from settings panel)
async function saveSettings(e) {
  e.preventDefault();
  const spreadsheetId = document.getElementById('settings-spreadsheet-id').value.trim();
  const sheetName = document.getElementById('settings-sheet-name').value.trim() || 'Trades';
  const startingCapital = parseLocalFloat(document.getElementById('settings-starting-capital').value) || 10000;
  
  showNotification('Saving settings...', 'info');
  
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spreadsheetId, sheetName, startingCapital })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      showNotification('Google Sheet settings updated successfully!', 'success');
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

// Auto Initialize Sheet Structure
async function initializeSheetStructure() {
  if (!sheetConfig || !sheetConfig.spreadsheetId) {
    showNotification('Spreadsheet ID is not configured!', 'warning');
    return;
  }
  
  showNotification('Initializing Google Sheet structure...', 'info');
  try {
    const res = await fetch('/api/init-sheet', { method: 'POST' });
    const data = await res.json();
    
    if (res.ok && data.success) {
      showNotification('Spreadsheet formatted & initialized successfully!', 'success');
    } else {
      showNotification(data.error || 'Failed to initialize spreadsheet', 'error');
    }
  } catch (err) {
    showNotification('Failed to format Google Sheet', 'error');
  }
}

// Fetch All Trade Data
async function fetchData() {
  if (!sheetConfig || !sheetConfig.spreadsheetId) return;
  
  showNotification('Loading trade data...', 'info');
  try {
    const res = await fetch('/api/trades');
    const data = await res.json();
    
    if (res.ok) {
      trades = data.trades || [];
      showNotification('Trade data loaded successfully!', 'success');
      
      // Update UI components depending on current page
      populateDateFilters();
      updateStatsAndCharts();
      populateTradesTable();
      populateSetupFilters();
    } else {
      showNotification(data.error || 'Failed to load trades', 'error');
    }
  } catch (err) {
    showNotification('Failed to load data from backend server', 'error');
  }
}

// Navigation / Switch Page
function switchPage(page) {
  currentPage = page;
  
  // Hide all pages
  dashboardPage.classList.remove('active');
  tradesPage.classList.remove('active');
  settingsPage.classList.remove('active');
  
  // Remove active nav styles
  navDashboard.classList.remove('active');
  navTrades.classList.remove('active');
  navSettings.classList.remove('active');
  
  // Show page
  if (page === 'dashboard') {
    dashboardPage.classList.add('active');
    navDashboard.classList.add('active');
    pageTitleText.innerText = 'Dashboard Summary';
    updateStatsAndCharts();
  } else if (page === 'trades') {
    tradesPage.classList.add('active');
    navTrades.classList.add('active');
    pageTitleText.innerText = 'Trades Journal Log';
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
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(absVal);
  
  return isNeg ? `-${formatted}` : formatted;
}

function formatPercent(val) {
  return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    return dateStr;
  }
}

// Toggle exit price based on status
function toggleExitField() {
  const status = document.getElementById('trade-status').value;
  const exitGroup = document.getElementById('exit-price-group');
  const exitInput = document.getElementById('trade-exit');
  
  if (status === 'Open') {
    exitGroup.style.opacity = '0.5';
    exitInput.disabled = true;
    exitInput.required = false;
    exitInput.value = '';
  } else {
    exitGroup.style.opacity = '1';
    exitInput.disabled = false;
    exitInput.required = true;
  }
}

// Modals operations
function openAddTradeModal() {
  tradeIdField.value = '';
  tradeForm.reset();
  document.getElementById('modal-title').innerText = 'Add New Trade';
  
  // Set default datetime to now
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localISOTime = new Date(now - offset).toISOString().slice(0, 16);
  document.getElementById('trade-date').value = localISOTime;
  
  toggleExitField();
  tradeModal.classList.add('active');
}

function openEditTradeModal(id) {
  const trade = trades.find(t => t.id === id);
  if (!trade) return;
  
  tradeIdField.value = trade.id;
  
  // Format date correctly for datetime-local
  let formattedDate = '';
  if (trade.date) {
    formattedDate = trade.date.replace(' ', 'T').substring(0, 16);
  }
  
  document.getElementById('trade-date').value = formattedDate;
  document.getElementById('trade-ticker').value = trade.ticker;
  document.getElementById('trade-action').value = trade.action;
  document.getElementById('trade-status').value = trade.status;
  document.getElementById('trade-setup').value = trade.setup;
  document.getElementById('trade-entry').value = trade.entryPrice;
  document.getElementById('trade-exit').value = trade.status === 'Open' ? '' : trade.exitPrice;
  document.getElementById('trade-size').value = trade.size;
  document.getElementById('trade-fees').value = trade.fees;
  document.getElementById('trade-pnl-input').value = (trade.pnl !== undefined && trade.pnl !== null) ? trade.pnl : '';
  document.getElementById('trade-notes').value = trade.notes;
  
  document.getElementById('modal-title').innerText = 'Edit Trade';
  toggleExitField();
  tradeModal.classList.add('active');
}

// Close Modal
function closeTradeModal() {
  tradeModal.classList.remove('active');
}

// Save or Update Trade Form Submit
async function saveTrade(e) {
  e.preventDefault();
  
  const id = tradeIdField.value;
  const isEdit = !!id;
  
  const rawDate = document.getElementById('trade-date').value;
  const dateFormatted = rawDate ? rawDate.replace('T', ' ') : '';
  
  const pnlInputVal = document.getElementById('trade-pnl-input').value.trim();
  const tradeData = {
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
      await fetchData();
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
    const res = await fetch(`/api/trades/${id}`, {
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
    const matchesSearch = !searchTicker || trade.ticker.includes(searchTicker);
    const matchesStatus = filterStatus === 'ALL' || trade.status === filterStatus;
    const matchesAction = filterAction === 'ALL' || trade.action === filterAction;
    const matchesSetup = filterSetup === 'ALL' || trade.setup === filterSetup;
    
    return matchesSearch && matchesStatus && matchesAction && matchesSetup;
  });
  
  renderTableRows(filtered);
}

// Render Table Rows
function renderTableRows(tradesList) {
  const tbody = document.getElementById('trades-tbody');
  const emptyState = document.getElementById('table-empty-state');
  
  tbody.innerHTML = '';
  
  if (tradesList.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  
  emptyState.style.display = 'none';
  const sortedTrades = [...tradesList].sort((a, b) => new Date(b.date) - new Date(a.date));
  
  sortedTrades.forEach(trade => {
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
      <td style="font-family: var(--font-mono); font-size: 0.8rem;">${formatDate(trade.date)}</td>
      <td><strong>${trade.ticker}</strong></td>
      <td>${actionBadge}</td>
      <td style="font-family: var(--font-mono);">${trade.entryPrice.toLocaleString()}</td>
      <td style="font-family: var(--font-mono);">${trade.status === 'Open' ? '-' : trade.exitPrice.toLocaleString()}</td>
      <td style="font-family: var(--font-mono);">${trade.size}</td>
      <td style="font-family: var(--font-mono);">${trade.fees > 0 ? trade.fees.toLocaleString() : '-'}</td>
      <td class="${pnlClass}" style="font-family: var(--font-mono); font-weight: 700;">${formattedPnl}</td>
      <td class="${pnlClass}" style="font-family: var(--font-mono); font-weight: 700;">${formattedRoi}</td>
      <td><span style="font-size:0.85rem; background:hsl(222, 18%, 8%); padding:4px 8px; border-radius:4px; border:1px solid var(--surface-border);">${trade.setup}</span></td>
      <td>${statusBadge}</td>
      <td>
        <div class="row-actions">
          <button class="btn-icon" onclick="openEditTradeModal('${trade.id}')" title="Edit Trade">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </button>
          <button class="btn-icon btn-icon-danger" onclick="deleteTrade('${trade.id}')" title="Delete Trade">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </td>
    `;
    
    tbody.appendChild(tr);
  });
}

function populateTradesTable() {
  renderTableRows(trades);
}

// Calculate Statistics and Render Charts
function updateStatsAndCharts() {
  if (currentPage !== 'dashboard') return;
  
  // Filter trades by date if a specific date is selected
  let activeTrades = [...trades];
  if (activeDateFilter !== 'all') {
    activeTrades = trades.filter(t => t.date && t.date.split(' ')[0] === activeDateFilter);
  }
  
  const closedTrades = activeTrades.filter(t => t.status !== 'Open');
  const openTradesCount = activeTrades.filter(t => t.status === 'Open').length;
  
  const totalTrades = activeTrades.length;
  const closedTradesCount = closedTrades.length;
  
  // Calculate Stats
  let netPnl = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalBreakeven = 0;
  let winSum = 0;
  let lossSum = 0;
  let roiSum = 0;
  
  closedTrades.forEach(trade => {
    netPnl += trade.pnl;
    roiSum += trade.roi;
    
    if (trade.status === 'Won') {
      totalWins++;
      winSum += trade.pnl;
    } else if (trade.status === 'Lost') {
      totalLosses++;
      lossSum += Math.abs(trade.pnl);
    } else if (trade.status === 'Breakeven') {
      totalBreakeven++;
      if (trade.pnl > 0) winSum += trade.pnl;
      else lossSum += Math.abs(trade.pnl);
    }
  });
  
  const winRate = closedTradesCount > 0 ? (totalWins / closedTradesCount) * 100 : 0;
  const profitFactor = lossSum > 0 ? winSum / lossSum : winSum > 0 ? 99.9 : 0;
  
  // Get starting capital
  const startingCapital = sheetConfig && sheetConfig.startingCapital ? parseLocalFloat(sheetConfig.startingCapital) : 10000;
  const accountRoi = startingCapital > 0 ? (netPnl / startingCapital) * 100 : 0;
  
  const avgWin = totalWins > 0 ? winSum / totalWins : 0;
  const avgLoss = totalLosses > 0 ? lossSum / totalLosses : 0;
  
  // Update DOM cards
  const totalBalance = startingCapital + netPnl;
  
  // Update Hero panel
  document.getElementById('hero-total-balance').innerText = formatCurrency(totalBalance);
  
  const heroPnlPill = document.getElementById('hero-pnl-pill');
  const heroPnlText = document.getElementById('hero-pnl-text');
  heroPnlText.innerText = `${netPnl >= 0 ? '+' : ''}${formatCurrency(netPnl)}`;
  if (netPnl > 0) {
    heroPnlPill.className = 'hero-pnl-pill positive';
  } else if (netPnl < 0) {
    heroPnlPill.className = 'hero-pnl-pill negative';
  } else {
    heroPnlPill.className = 'hero-pnl-pill neutral';
  }
  
  const heroAccountRoi = document.getElementById('hero-account-roi');
  heroAccountRoi.innerText = formatPercent(accountRoi);
  if (accountRoi > 0) {
    heroAccountRoi.className = 'hero-meta-value text-profit';
  } else if (accountRoi < 0) {
    heroAccountRoi.className = 'hero-meta-value text-loss';
  } else {
    heroAccountRoi.className = 'hero-meta-value text-neutral';
  }
  
  document.getElementById('hero-win-rate').innerText = `${Math.round(winRate)}%`;
  document.getElementById('hero-total-trades').innerText = totalTrades;
  
  // Update Net Profit/Loss card
  const netPnlEl = document.getElementById('stat-net-pnl');
  const cardPnl = document.getElementById('card-pnl');
  const trendIconEl = document.getElementById('pnl-trend-icon');
  
  netPnlEl.innerText = formatCurrency(netPnl);
  
  // Calculate average ROI of individual trades
  const avgTradeRoi = closedTradesCount > 0 ? roiSum / closedTradesCount : 0;
  document.getElementById('stat-avg-roi').innerText = `${formatPercent(avgTradeRoi)} Avg. Trade ROI`;
  
  if (netPnl > 0) {
    cardPnl.className = 'stat-card positive';
    trendIconEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-profit"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>`;
  } else if (netPnl < 0) {
    cardPnl.className = 'stat-card negative';
    trendIconEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-loss"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg>`;
  } else {
    cardPnl.className = 'stat-card neutral';
    trendIconEl.innerHTML = '';
  }
  
  // Update Win/Loss card
  document.getElementById('stat-win-loss-ratio-val').innerText = `${Math.round(winRate)}%`;
  document.getElementById('stat-win-loss-ratio').innerText = `${totalWins} Won / ${totalLosses} Lost`;
  
  // Update Profit Factor card
  document.getElementById('stat-profit-factor').innerText = profitFactor.toFixed(2);
  document.getElementById('stat-avg-win-loss').innerText = `Avg Win: ${formatCurrency(avgWin)} / Loss: ${formatCurrency(-avgLoss)}`;
  
  // Update Open Trades card
  document.getElementById('stat-open-trades-val').innerText = openTradesCount;
  document.getElementById('stat-open-trades-ratio').innerText = `${openTradesCount} Open / ${totalTrades} Total`;
  
  // Render / Update Charts
  renderEquityChart(closedTrades);
  renderWinLossChart(totalWins, totalLosses, totalBreakeven);
  renderStrategyChart(closedTrades);
  renderDayChart(closedTrades);
}

// ---------------- CHART RENDERING LOGIC ----------------

function getChartStyles() {
  return {
    textColor: '#a0aec0',
    gridColor: 'rgba(255, 255, 255, 0.05)',
    tooltipBg: '#1e293b',
    tooltipBorder: '#334155'
  };
}

function renderEquityChart(closedTrades) {
  const ctx = document.getElementById('equityChart').getContext('2d');
  
  if (charts.equity) {
    charts.equity.destroy();
  }
  
  // Sort chronologically ascending
  const sorted = [...closedTrades].sort((a, b) => new Date(a.date) - new Date(b.date));
  
  const startingCapital = sheetConfig && sheetConfig.startingCapital ? parseLocalFloat(sheetConfig.startingCapital) : 10000;
  
  let cumulative = startingCapital;
  const data = [startingCapital];
  const labels = ['Start'];
  
  sorted.forEach((trade, i) => {
    cumulative += trade.pnl;
    data.push(Math.round(cumulative * 100) / 100);
    labels.push(trade.ticker + ` (#${i+1})`);
  });
  
  const styles = getChartStyles();
  
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(26, 188, 156, 0.3)');
  gradient.addColorStop(1, 'rgba(26, 188, 156, 0.0)');
  
  charts.equity = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Balance ($)',
        data,
        borderColor: '#1abc9c',
        borderWidth: 3,
        fill: true,
        backgroundColor: gradient,
        tension: 0.3,
        pointBackgroundColor: '#1abc9c',
        pointRadius: data.length > 20 ? 0 : 4,
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
          callbacks: {
            label: function(context) {
              return `Balance: ${formatCurrency(context.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: styles.gridColor },
          ticks: { color: styles.textColor }
        },
        y: {
          grid: { color: styles.gridColor },
          ticks: { color: styles.textColor }
        }
      }
    }
  });
}

function renderWinLossChart(wins, losses, breakevens) {
  const ctx = document.getElementById('winLossChart').getContext('2d');
  
  if (charts.winLoss) {
    charts.winLoss.destroy();
  }
  
  const styles = getChartStyles();
  
  charts.winLoss = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Won', 'Lost', 'Breakeven'],
      datasets: [{
        data: [wins, losses, breakevens],
        backgroundColor: ['#2ecc71', '#e74c3c', '#f1c40f'],
        borderColor: '#151f32',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: styles.textColor, font: { family: 'Plus Jakarta Sans', weight: '600' } }
        },
        tooltip: {
          backgroundColor: styles.tooltipBg,
          borderColor: styles.tooltipBorder,
          borderWidth: 1
        }
      }
    }
  });
}

function renderStrategyChart(closedTrades) {
  const ctx = document.getElementById('strategyChart').getContext('2d');
  
  if (charts.strategy) {
    charts.strategy.destroy();
  }
  
  const stratData = {};
  closedTrades.forEach(trade => {
    const setup = trade.setup || 'General';
    if (!stratData[setup]) stratData[setup] = 0;
    stratData[setup] += trade.pnl;
  });
  
  const labels = Object.keys(stratData);
  const data = Object.values(stratData).map(v => Math.round(v * 100) / 100);
  
  const backgroundColors = data.map(v => v >= 0 ? 'rgba(46, 204, 113, 0.7)' : 'rgba(231, 76, 60, 0.7)');
  const borderColors = data.map(v => v >= 0 ? '#2ecc71' : '#e74c3c');
  
  const styles = getChartStyles();
  
  charts.strategy = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: backgroundColors,
        borderColor: borderColors,
        borderWidth: 1.5,
        borderRadius: 4
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
            label: function(context) {
              return `Net P&L: ${formatCurrency(context.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: styles.gridColor },
          ticks: { color: styles.textColor }
        },
        y: {
          grid: { color: styles.gridColor },
          ticks: { color: styles.textColor }
        }
      }
    }
  });
}

function renderDayChart(closedTrades) {
  const ctx = document.getElementById('dayChart').getContext('2d');
  
  if (charts.day) {
    charts.day.destroy();
  }
  
  const dayPnl = [0, 0, 0, 0, 0, 0, 0];
  
  closedTrades.forEach(trade => {
    if (!trade.date) return;
    const date = new Date(trade.date);
    const dayIndex = date.getDay(); // 0-6
    dayPnl[dayIndex] += trade.pnl;
  });
  
  const orderedLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const orderedData = [dayPnl[1], dayPnl[2], dayPnl[3], dayPnl[4], dayPnl[5], dayPnl[6], dayPnl[0]].map(v => Math.round(v * 100) / 100);
  
  const backgroundColors = orderedData.map(v => v >= 0 ? 'rgba(26, 188, 156, 0.7)' : 'rgba(231, 76, 60, 0.7)');
  const borderColors = orderedData.map(v => v >= 0 ? '#1abc9c' : '#e74c3c');
  
  const styles = getChartStyles();
  
  charts.day = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: orderedLabels,
      datasets: [{
        data: orderedData,
        backgroundColor: backgroundColors,
        borderColor: borderColors,
        borderWidth: 1.5,
        borderRadius: 4
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
            label: function(context) {
              return `Net P&L: ${formatCurrency(context.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: styles.gridColor },
          ticks: { color: styles.textColor }
        },
        y: {
          grid: { color: styles.gridColor },
          ticks: { color: styles.textColor }
        }
      }
    }
  });
}

// Populate unique dates into Dashboard Filter select dropdown
function populateDateFilters() {
  const select = document.getElementById('dashboard-date-filter');
  if (!select) return;
  
  select.innerHTML = '<option value="all">Semua Histori (Default)</option>';
  
  // Get unique dates (YYYY-MM-DD)
  const uniqueDates = [...new Set(trades
    .map(t => t.date ? t.date.split(' ')[0] : null)
    .filter(d => d !== null && d !== '')
  )];
  
  // Sort descending
  uniqueDates.sort((a, b) => new Date(b) - new Date(a));
  
  // Add option elements
  uniqueDates.forEach(date => {
    const opt = document.createElement('option');
    opt.value = date;
    opt.innerText = formatDateIndo(date);
    select.appendChild(opt);
  });
  
  select.value = activeDateFilter;
}

// Format date into a human readable Indonesian format e.g. "19 Aug 2026"
function formatDateIndo(dateStr) {
  if (!dateStr) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      if (monthIdx >= 0 && monthIdx < 12) {
        return `${day} ${months[monthIdx]} ${year}`;
      }
    }
  } catch (e) {}
  return dateStr; // fallback to original string
}

// Triggered when date filter changes
function filterDashboardByDate(val) {
  activeDateFilter = val;
  updateStatsAndCharts();
}
