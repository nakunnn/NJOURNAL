const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CREDENTIALS_PATH = process.env.GOOGLE_CREDS_PATH || '/home/vaio/file/STORE/MarinMD/optical-mode-435812-m2-f1e797ae5615.json';
const CONFIG_PATH = path.join(__dirname, 'config.json');

// Default accounts definition
const DEFAULT_ACCOUNTS = {
  "1": { name: "Akun 1", sheetName: "Trades", startingCapital: 10000 },
  "2": { name: "Akun 2", sheetName: "Akun 2", startingCapital: 10000 },
  "3": { name: "Akun 3", sheetName: "Akun 3", startingCapital: 10000 }
};

// Default app config
let appConfig = {
  spreadsheetId: process.env.SPREADSHEET_ID || '',
  currentAccount: '1',
  accounts: JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS))
};

// Load config if exists and env variables aren't already set
if (!process.env.SPREADSHEET_ID && fs.existsSync(CONFIG_PATH)) {
  try {
    const savedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (savedConfig.accounts) {
      appConfig = { 
        ...appConfig, 
        ...savedConfig,
        accounts: {
          ...DEFAULT_ACCOUNTS,
          ...savedConfig.accounts
        }
      };
    } else {
      // Migrate legacy config format
      appConfig.spreadsheetId = savedConfig.spreadsheetId || appConfig.spreadsheetId;
      appConfig.currentAccount = '1';
      appConfig.accounts["1"].sheetName = savedConfig.sheetName || 'Trades';
      appConfig.accounts["1"].startingCapital = parseFloat(savedConfig.startingCapital) || 10000;
    }
  } catch (err) {
    console.error('Error reading config.json, resetting to default', err);
  }
}

// Save config helper
function saveConfig(config) {
  appConfig = { ...appConfig, ...config };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(appConfig, null, 2), 'utf8');
  } catch (err) {
    console.warn('Could not write to config.json (possibly read-only env):', err.message);
  }
}

// Helper to get an account object safely
function getAccountConfig(accountId) {
  const id = String(accountId || appConfig.currentAccount || '1');
  if (!appConfig.accounts[id]) {
    appConfig.accounts[id] = { 
      name: `Akun ${id}`, 
      sheetName: id === '1' ? 'Trades' : `Akun ${id}`, 
      startingCapital: 10000 
    };
  }
  return { id, ...appConfig.accounts[id] };
}

// Google Sheets auth setup
function getGoogleAuthClient() {
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    let privateKey = process.env.GOOGLE_PRIVATE_KEY.trim();
    
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    } else if (privateKey.startsWith("'") && privateKey.endsWith("'")) {
      privateKey = privateKey.slice(1, -1);
    }
    
    privateKey = privateKey.replace(/\\n/g, '\n');

    return new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: privateKey
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`Credentials file not found at ${CREDENTIALS_PATH}. Please configure GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY environment variables.`);
  }
  
  return new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsService() {
  const auth = getGoogleAuthClient();
  return google.sheets({ version: 'v4', auth });
}

// Get Service Account email
let serviceAccountEmail = process.env.GOOGLE_CLIENT_EMAIL || '';
try {
  if (!serviceAccountEmail && fs.existsSync(CREDENTIALS_PATH)) {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    serviceAccountEmail = creds.client_email;
  }
} catch (e) {
  console.error('Failed to parse credentials for email:', e);
}

// Core headers for our trading sheet
const HEADERS = [
  'Trade ID',
  'Date',
  'Ticker',
  'Action',
  'Entry Price',
  'Exit Price',
  'Size',
  'Fees',
  'P&L',
  'ROI %',
  'Setup',
  'Status',
  'Notes'
];

// Helper to convert row array to trade object
function rowToTrade(row, index) {
  const parseVal = (val) => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val;
    const clean = String(val).replace(/,/g, '.').replace(/\s/g, '');
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
  };

  return {
    rowNumber: index + 1,
    id: row[0] || '',
    date: row[1] || '',
    ticker: row[2] || '',
    action: row[3] || '',
    entryPrice: parseVal(row[4]),
    exitPrice: parseVal(row[5]),
    size: parseVal(row[6]),
    fees: parseVal(row[7]),
    pnl: parseVal(row[8]),
    roi: parseVal(row[9]),
    setup: row[10] || 'General',
    status: row[11] || 'Open',
    notes: row[12] || ''
  };
}

// Helper to convert trade object to row array
function tradeToRow(trade) {
  return [
    trade.id || `T-${Date.now()}`,
    trade.date || new Date().toISOString().replace('T', ' ').substring(0, 16),
    (trade.ticker || '').toUpperCase(),
    trade.action || 'Long',
    parseFloat(trade.entryPrice) || 0,
    parseFloat(trade.exitPrice) || 0,
    parseFloat(trade.size) || 0,
    parseFloat(trade.fees) || 0,
    parseFloat(trade.pnl) || 0,
    parseFloat(trade.roi) || 0,
    trade.setup || 'General',
    trade.status || 'Open',
    trade.notes || ''
  ];
}

// Helper to get starting capital for an account from Google Sheet Config tab
async function getStartingCapitalFromSheet(sheets, spreadsheetId, accountId = '1') {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Config!A1:B20',
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const rows = response.data.values;
    if (rows && rows.length > 0) {
      const keySpecific = `startingCapital_${accountId}`;
      const rowSpecific = rows.find(r => r[0] === keySpecific);
      if (rowSpecific && rowSpecific[1] !== undefined) {
        const parsed = parseFloat(rowSpecific[1]);
        if (!isNaN(parsed)) return parsed;
      }
      if (accountId === '1') {
        const legacyRow = rows.find(r => r[0] === 'startingCapital');
        if (legacyRow && legacyRow[1] !== undefined) {
          const parsed = parseFloat(legacyRow[1]);
          if (!isNaN(parsed)) return parsed;
        }
      }
    }
  } catch (err) {
    console.log(`Config sheet tab startingCapital for account ${accountId} not found or readable.`);
  }
  return null;
}

// Helper to save starting capital for an account to Google Sheet Config tab
async function saveStartingCapitalToSheet(sheets, spreadsheetId, accountId, value) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = meta.data.sheets.find(s => s.properties.title === 'Config');
    
    if (!existingSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: 'Config' } } }]
        }
      });
    }
    
    let currentRows = [];
    try {
      const getRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Config!A:B',
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      if (getRes.data.values) currentRows = getRes.data.values;
    } catch (e) {}

    if (currentRows.length === 0) {
      currentRows = [['Key', 'Value']];
    }
    
    const key = `startingCapital_${accountId}`;
    const rowIndex = currentRows.findIndex(r => r[0] === key);
    if (rowIndex >= 0) {
      currentRows[rowIndex][1] = value;
    } else {
      currentRows.push([key, value]);
    }
    
    if (accountId === '1') {
      const legacyIdx = currentRows.findIndex(r => r[0] === 'startingCapital');
      if (legacyIdx >= 0) {
        currentRows[legacyIdx][1] = value;
      } else {
        currentRows.push(['startingCapital', value]);
      }
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Config!A1:B' + currentRows.length,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: currentRows
      }
    });
    console.log(`Saved startingCapital_${accountId} to Google Sheet Config tab:`, value);
  } catch (err) {
    console.error('Error saving startingCapital to Google Sheet:', err.message);
  }
}

// Helper to ensure a sheet tab exists with headers
async function ensureSheetTabExists(sheets, spreadsheetId, sheetName) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existing = meta.data.sheets.find(s => s.properties.title === sheetName);
    if (!existing) {
      const createRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }]
        }
      });
      const sheetId = createRes.data.replies[0].addSheet.properties.sheetId;
      
      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:M1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [HEADERS] }
      });
      
      // Format headers: freeze top row
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            updateSheetProperties: {
              properties: {
                sheetId: sheetId,
                gridProperties: { frozenRowCount: 1 }
              },
              fields: 'gridProperties.frozenRowCount'
            }
          }]
        }
      });
      console.log(`Auto-created missing sheet tab '${sheetName}' with headers.`);
    }
  } catch (err) {
    console.error(`Error ensuring sheet tab '${sheetName}' exists:`, err.message);
  }
}

// API: Get Configuration details
app.get('/api/config', async (req, res) => {
  try {
    let connected = false;
    let sheetTitle = '';
    
    if (appConfig.spreadsheetId) {
      try {
        const sheets = getSheetsService();
        const response = await sheets.spreadsheets.get({
          spreadsheetId: appConfig.spreadsheetId,
        });
        sheetTitle = response.data.properties.title;
        connected = true;
        
        // Fetch starting capital dynamically for all accounts
        for (const accId of ['1', '2', '3']) {
          const sheetCapital = await getStartingCapitalFromSheet(sheets, appConfig.spreadsheetId, accId);
          if (sheetCapital !== null && appConfig.accounts[accId]) {
            appConfig.accounts[accId].startingCapital = sheetCapital;
          }
        }
      } catch (err) {
        console.error('Google Sheets connection check failed:', err.message);
      }
    }
    
    const activeAcc = getAccountConfig(appConfig.currentAccount);
    
    res.json({
      spreadsheetId: appConfig.spreadsheetId,
      currentAccount: appConfig.currentAccount || '1',
      accounts: appConfig.accounts,
      sheetName: activeAcc.sheetName,
      startingCapital: parseFloat(activeAcc.startingCapital) || 10000,
      serviceAccountEmail,
      connected,
      sheetTitle
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Save Configuration
app.post('/api/config', async (req, res) => {
  const { spreadsheetId, currentAccount, accounts, sheetName, startingCapital, accountId } = req.body;
  if (!spreadsheetId && !appConfig.spreadsheetId) {
    return res.status(400).json({ error: 'Spreadsheet ID is required' });
  }
  
  const targetSpreadsheetId = spreadsheetId || appConfig.spreadsheetId;
  const targetAccountId = String(accountId || currentAccount || appConfig.currentAccount || '1');
  
  try {
    const auth = getGoogleAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    
    const sheetMeta = await sheets.spreadsheets.get({
      spreadsheetId: targetSpreadsheetId,
    });
    
    if (accounts) {
      appConfig.accounts = { ...appConfig.accounts, ...accounts };
      for (const [id, acc] of Object.entries(accounts)) {
        if (acc.startingCapital !== undefined) {
          await saveStartingCapitalToSheet(sheets, targetSpreadsheetId, id, parseFloat(acc.startingCapital) || 10000);
        }
      }
    }
    
    if (sheetName || startingCapital !== undefined) {
      if (!appConfig.accounts[targetAccountId]) {
        appConfig.accounts[targetAccountId] = { name: `Akun ${targetAccountId}`, sheetName: `Akun ${targetAccountId}`, startingCapital: 10000 };
      }
      if (sheetName) appConfig.accounts[targetAccountId].sheetName = sheetName;
      if (startingCapital !== undefined) {
        const cap = parseFloat(startingCapital) >= 0 ? parseFloat(startingCapital) : 10000;
        appConfig.accounts[targetAccountId].startingCapital = cap;
        await saveStartingCapitalToSheet(sheets, targetSpreadsheetId, targetAccountId, cap);
      }
    }
    
    if (currentAccount) {
      appConfig.currentAccount = String(currentAccount);
    }
    
    saveConfig({
      spreadsheetId: targetSpreadsheetId,
      currentAccount: appConfig.currentAccount,
      accounts: appConfig.accounts
    });
    
    res.json({
      success: true,
      sheetTitle: sheetMeta.data.properties.title,
      message: 'Configuration saved successfully.'
    });
  } catch (err) {
    console.error('Error connecting to sheet:', err);
    res.status(400).json({
      error: `Failed to connect: ${err.message}. Make sure you shared the spreadsheet with Editor role to: ${serviceAccountEmail}`
    });
  }
});

// API: Switch Active Account
app.post('/api/switch-account', (req, res) => {
  const { accountId } = req.body;
  if (!accountId) {
    return res.status(400).json({ error: 'Account ID is required' });
  }
  appConfig.currentAccount = String(accountId);
  saveConfig({ currentAccount: appConfig.currentAccount });
  const acc = getAccountConfig(appConfig.currentAccount);
  res.json({ success: true, currentAccount: appConfig.currentAccount, account: acc });
});

// API: Auto Initialize All Sheet Tabs for Multi-Account
app.post('/api/init-sheet', async (req, res) => {
  if (!appConfig.spreadsheetId) {
    return res.status(400).json({ error: 'Spreadsheet ID is not configured.' });
  }
  
  try {
    const sheets = getSheetsService();
    const spreadsheetId = appConfig.spreadsheetId;
    const accountIds = Object.keys(appConfig.accounts || DEFAULT_ACCOUNTS);
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    
    for (const accId of accountIds) {
      const acc = appConfig.accounts[accId] || DEFAULT_ACCOUNTS[accId];
      const sheetName = acc.sheetName || (accId === '1' ? 'Trades' : `Akun ${accId}`);
      const existingSheet = meta.data.sheets.find(s => s.properties.title === sheetName);
      
      let sheetId = null;
      if (!existingSheet) {
        const createResponse = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: sheetName } } }]
          }
        });
        sheetId = createResponse.data.replies[0].addSheet.properties.sheetId;
      } else {
        sheetId = existingSheet.properties.sheetId;
      }
      
      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:M1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [HEADERS] }
      });
      
      // Format headers
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: sheetId,
                  gridProperties: { frozenRowCount: 1 }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            },
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: HEADERS.length
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }
                  }
                },
                fields: 'userEnteredFormat(textFormat,backgroundColor)'
              }
            }
          ]
        }
      });
    }
    
    res.json({ success: true, message: 'All account sheets (Akun 1, Akun 2, Akun 3) initialized successfully with headers.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get All Trades for Specific Account
app.get('/api/trades', async (req, res) => {
  if (!appConfig.spreadsheetId) {
    return res.json({ trades: [], error: 'Spreadsheet ID not configured' });
  }
  
  const accountId = req.query.account || appConfig.currentAccount || '1';
  const acc = getAccountConfig(accountId);
  
  try {
    const sheets = getSheetsService();
    const range = `${acc.sheetName}!A:M`;
    
    // Auto-ensure sheet tab exists
    await ensureSheetTabExists(sheets, appConfig.spreadsheetId, acc.sheetName);
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: appConfig.spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    
    const rows = response.data.values;
    if (!rows || rows.length <= 1) {
      return res.json({ trades: [] });
    }
    
    const trades = rows.slice(1).map((row, index) => rowToTrade(row, index + 1));
    const validTrades = trades.filter(t => t.id || t.ticker);
    
    res.json({ trades: validTrades, account: acc });
  } catch (err) {
    console.error('Error fetching trades:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Add a Trade to Specific Account
app.post('/api/trades', async (req, res) => {
  if (!appConfig.spreadsheetId) {
    return res.status(400).json({ error: 'Spreadsheet ID not configured' });
  }
  
  const accountId = req.body.account || req.query.account || appConfig.currentAccount || '1';
  const acc = getAccountConfig(accountId);
  
  try {
    const sheets = getSheetsService();
    const trade = req.body;
    
    const entry = parseFloat(trade.entryPrice) || 0;
    const exit = parseFloat(trade.exitPrice) || 0;
    const size = parseFloat(trade.size) || 0;
    const fees = parseFloat(trade.fees) || 0;
    const action = trade.action || 'Long';
    
    let pnl = 0;
    let roi = 0;
    
    if (trade.pnl !== undefined && trade.pnl !== null && trade.pnl !== '') {
      pnl = parseFloat(trade.pnl);
      const capital = entry * size;
      if (capital > 0) {
        roi = (pnl / capital) * 100;
      } else {
        roi = parseFloat(trade.roi) || 0;
      }
    } else if (trade.status !== 'Open') {
      if (action.toLowerCase() === 'long' || action.toLowerCase() === 'buy') {
        pnl = (exit - entry) * size - fees;
      } else {
        pnl = (entry - exit) * size - fees;
      }
      
      const capital = entry * size;
      if (capital > 0) {
        roi = (pnl / capital) * 100;
      }
    } else {
      pnl = 0;
      roi = 0;
    }
    
    trade.pnl = Math.round(pnl * 100) / 100;
    trade.roi = Math.round(roi * 100) / 100;
    trade.id = `T-${Date.now()}`;
    
    await ensureSheetTabExists(sheets, appConfig.spreadsheetId, acc.sheetName);
    
    const rowData = tradeToRow(trade);
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: appConfig.spreadsheetId,
      range: `${acc.sheetName}!A:M`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [rowData]
      }
    });
    
    res.json({ success: true, trade, account: acc });
  } catch (err) {
    console.error('Error adding trade:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Update an Existing Trade in Specific Account
app.put('/api/trades/:id', async (req, res) => {
  if (!appConfig.spreadsheetId) {
    return res.status(400).json({ error: 'Spreadsheet ID not configured' });
  }
  
  const tradeId = req.params.id;
  const updatedTrade = req.body;
  const accountId = req.body.account || req.query.account || appConfig.currentAccount || '1';
  const acc = getAccountConfig(accountId);
  
  try {
    const sheets = getSheetsService();
    const spreadsheetId = appConfig.spreadsheetId;
    const sheetName = acc.sheetName;
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:M`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    
    const rows = response.data.values;
    if (!rows) {
      return res.status(404).json({ error: 'No data found in sheet' });
    }
    
    const rowIndex = rows.findIndex(row => row[0] === tradeId);
    if (rowIndex === -1) {
      return res.status(404).json({ error: 'Trade ID not found in sheet' });
    }
    
    const entry = parseFloat(updatedTrade.entryPrice) || 0;
    const exit = parseFloat(updatedTrade.exitPrice) || 0;
    const size = parseFloat(updatedTrade.size) || 0;
    const fees = parseFloat(updatedTrade.fees) || 0;
    const action = updatedTrade.action || 'Long';
    
    let pnl = 0;
    let roi = 0;
    
    if (updatedTrade.pnl !== undefined && updatedTrade.pnl !== null && updatedTrade.pnl !== '') {
      pnl = parseFloat(updatedTrade.pnl);
      const capital = entry * size;
      if (capital > 0) {
        roi = (pnl / capital) * 100;
      } else {
        roi = parseFloat(updatedTrade.roi) || 0;
      }
    } else if (updatedTrade.status !== 'Open') {
      if (action.toLowerCase() === 'long' || action.toLowerCase() === 'buy') {
        pnl = (exit - entry) * size - fees;
      } else {
        pnl = (entry - exit) * size - fees;
      }
      
      const capital = entry * size;
      if (capital > 0) {
        roi = (pnl / capital) * 100;
      }
    } else {
      pnl = 0;
      roi = 0;
    }
    
    updatedTrade.pnl = Math.round(pnl * 100) / 100;
    updatedTrade.roi = Math.round(roi * 100) / 100;
    updatedTrade.id = tradeId;
    
    const rowData = tradeToRow(updatedTrade);
    const updateRange = `${sheetName}!A${rowIndex + 1}:M${rowIndex + 1}`;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: updateRange,
      valueInputOption: 'RAW',
      requestBody: {
        values: [rowData]
      }
    });
    
    res.json({ success: true, trade: updatedTrade, account: acc });
  } catch (err) {
    console.error('Error updating trade:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Delete a Trade from Specific Account
app.delete('/api/trades/:id', async (req, res) => {
  if (!appConfig.spreadsheetId) {
    return res.status(400).json({ error: 'Spreadsheet ID not configured' });
  }
  
  const tradeId = req.params.id;
  const accountId = req.query.account || appConfig.currentAccount || '1';
  const acc = getAccountConfig(accountId);
  
  try {
    const sheets = getSheetsService();
    const spreadsheetId = appConfig.spreadsheetId;
    const sheetName = acc.sheetName;
    
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetInfo = meta.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheetInfo) {
      return res.status(404).json({ error: `Sheet tab '${sheetName}' not found` });
    }
    const sheetId = sheetInfo.properties.sheetId;
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:M`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    
    const rows = response.data.values;
    if (!rows) {
      return res.status(404).json({ error: 'No data found in sheet' });
    }
    
    const rowIndex = rows.findIndex(row => row[0] === tradeId);
    if (rowIndex === -1) {
      return res.status(404).json({ error: 'Trade ID not found in sheet' });
    }
    
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex,
                endIndex: rowIndex + 1
              }
            }
          }
        ]
      }
    });
    
    res.json({ success: true, message: `Trade ${tradeId} deleted successfully.`, account: acc });
  } catch (err) {
    console.error('Error deleting trade:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
