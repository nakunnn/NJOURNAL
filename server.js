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

// Default config
let appConfig = {
  spreadsheetId: process.env.SPREADSHEET_ID || '',
  sheetName: process.env.SHEET_NAME || 'Trades',
  startingCapital: parseFloat(process.env.STARTING_CAPITAL) || 10000
};

// Load config if exists and env variables aren't already set
if (!process.env.SPREADSHEET_ID && fs.existsSync(CONFIG_PATH)) {
  try {
    const savedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    appConfig = { ...appConfig, ...savedConfig };
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

// Google Sheets auth setup
function getGoogleAuthClient() {
  // Option 1: Load directly from environment variables
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    return new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: privateKey
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  // Option 2: Load from credentials JSON file
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
  // Row contains strings from the sheet. Index is the 1-based row number.
  return {
    rowNumber: index + 1, // Store the row number (1-indexed) in spreadsheet
    id: row[0] || '',
    date: row[1] || '',
    ticker: row[2] || '',
    action: row[3] || '',
    entryPrice: parseFloat(row[4]) || 0,
    exitPrice: parseFloat(row[5]) || 0,
    size: parseFloat(row[6]) || 0,
    fees: parseFloat(row[7]) || 0,
    pnl: parseFloat(row[8]) || 0,
    roi: parseFloat(row[9]) || 0,
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
    trade.entryPrice || 0,
    trade.exitPrice || 0,
    trade.size || 0,
    trade.fees || 0,
    trade.pnl || 0,
    trade.roi || 0,
    trade.setup || 'General',
    trade.status || 'Open',
    trade.notes || ''
  ];
}

// Helper to get starting capital from Google Sheet Config tab
async function getStartingCapitalFromSheet(sheets, spreadsheetId) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Config!A1:B10',
    });
    const rows = response.data.values;
    if (rows && rows.length > 0) {
      const row = rows.find(r => r[0] === 'startingCapital');
      if (row && row[1]) {
        const parsed = parseFloat(row[1]);
        if (!isNaN(parsed)) return parsed;
      }
    }
  } catch (err) {
    // If the Config sheet tab does not exist yet, we ignore the error
    console.log('startingCapital Config sheet tab not found or readable, using default.');
  }
  return null;
}

// Helper to save starting capital to Google Sheet Config tab
async function saveStartingCapitalToSheet(sheets, spreadsheetId, value) {
  try {
    // Verify or Create Config sheet tab
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
    
    // Write key-value pair
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Config!A1:B2',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['Key', 'Value'],
          ['startingCapital', value]
        ]
      }
    });
    console.log('Saved startingCapital to Google Sheet Config tab:', value);
  } catch (err) {
    console.error('Error saving startingCapital to Google Sheet:', err.message);
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
        
        // Fetch starting capital dynamically from Google Sheets Config tab!
        const sheetCapital = await getStartingCapitalFromSheet(sheets, appConfig.spreadsheetId);
        if (sheetCapital !== null) {
          appConfig.startingCapital = sheetCapital;
        }
      } catch (err) {
        console.error('Google Sheets connection check failed:', err.message);
      }
    }
    
    res.json({
      spreadsheetId: appConfig.spreadsheetId,
      sheetName: appConfig.sheetName,
      startingCapital: parseFloat(appConfig.startingCapital) || 10000,
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
  const { spreadsheetId, sheetName, startingCapital } = req.body;
  if (!spreadsheetId) {
    return res.status(400).json({ error: 'Spreadsheet ID is required' });
  }
  
  const targetSheetName = sheetName || 'Trades';
  const capital = parseFloat(startingCapital) >= 0 ? parseFloat(startingCapital) : 10000;
  
  try {
    // Validate connection
    const auth = getGoogleAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    
    const sheetMeta = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
    });
    
    // Save startingCapital dynamically to Google Sheets Config tab!
    await saveStartingCapitalToSheet(sheets, spreadsheetId, capital);
    
    saveConfig({
      spreadsheetId,
      sheetName: targetSheetName,
      startingCapital: capital
    });
    
    res.json({
      success: true,
      sheetTitle: sheetMeta.data.properties.title,
      message: 'Connection successful and configuration saved.'
    });
  } catch (err) {
    console.error('Error connecting to sheet:', err);
    res.status(400).json({
      error: `Failed to connect: ${err.message}. Make sure you shared the spreadsheet with Editor role to: ${serviceAccountEmail}`
    });
  }
});

// API: Auto Initialize Sheet Structure
app.post('/api/init-sheet', async (req, res) => {
  if (!appConfig.spreadsheetId) {
    return res.status(400).json({ error: 'Spreadsheet ID is not configured.' });
  }
  
  try {
    const sheets = getSheetsService();
    const spreadsheetId = appConfig.spreadsheetId;
    const sheetName = appConfig.sheetName;
    
    // Check if sheet tab exists, if not create it
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = meta.data.sheets.find(s => s.properties.title === sheetName);
    
    let sheetId = null;
    
    if (!existingSheet) {
      // Create a new sheet tab
      const createResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName
                }
              }
            }
          ]
        }
      });
      sheetId = createResponse.data.replies[0].addSheet.properties.sheetId;
    } else {
      sheetId = existingSheet.properties.sheetId;
    }
    
    // Write headers and apply some styling (freeze first row, bold text)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:M1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [HEADERS]
      }
    });
    
    // Apply styling: Freeze row 1 and format bold headers
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: sheetId,
                gridProperties: {
                  frozenRowCount: 1
                }
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
                  textFormat: {
                    bold: true
                  },
                  backgroundColor: {
                    red: 0.9,
                    green: 0.9,
                    blue: 0.9
                  }
                }
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor)'
            }
          }
        ]
      }
    });
    
    res.json({ success: true, message: `Sheet '${sheetName}' initialized successfully with headers.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get All Trades
app.get('/api/trades', async (req, res) => {
  if (!appConfig.spreadsheetId) {
    return res.json({ trades: [], error: 'Spreadsheet ID not configured' });
  }
  
  try {
    const sheets = getSheetsService();
    const range = `${appConfig.sheetName}!A:M`;
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: appConfig.spreadsheetId,
      range,
    });
    
    const rows = response.data.values;
    if (!rows || rows.length <= 1) {
      // Empty or only headers
      return res.json({ trades: [] });
    }
    
    // Header is row 0. Trades are row 1 onwards.
    const trades = rows.slice(1).map((row, index) => rowToTrade(row, index + 1));
    // Filter out rows that are entirely empty
    const validTrades = trades.filter(t => t.id || t.ticker);
    
    res.json({ trades: validTrades });
  } catch (err) {
    console.error('Error fetching trades:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Add a Trade
app.post('/api/trades', async (req, res) => {
  if (!appConfig.spreadsheetId) {
    return res.status(400).json({ error: 'Spreadsheet ID not configured' });
  }
  
  try {
    const sheets = getSheetsService();
    const trade = req.body;
    
    // Auto-calculate P&L and ROI
    // Long: P&L = (Exit - Entry) * Size - Fees
    // Short: P&L = (Entry - Exit) * Size - Fees
    // ROI = P&L / (Entry * Size) * 100
    const entry = parseFloat(trade.entryPrice) || 0;
    const exit = parseFloat(trade.exitPrice) || 0;
    const size = parseFloat(trade.size) || 0;
    const fees = parseFloat(trade.fees) || 0;
    const action = trade.action || 'Long';
    
    let pnl = 0;
    let roi = 0;
    
    if (trade.status !== 'Open') {
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
    
    trade.pnl = Math.round(pnl * 100) / 100; // round to 2 decimal places
    trade.roi = Math.round(roi * 100) / 100;
    trade.id = `T-${Date.now()}`;
    
    const rowData = tradeToRow(trade);
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: appConfig.spreadsheetId,
      range: `${appConfig.sheetName}!A:M`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [rowData]
      }
    });
    
    res.json({ success: true, trade });
  } catch (err) {
    console.error('Error adding trade:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Update an Existing Trade
app.put('/api/trades/:id', async (req, res) => {
  if (!appConfig.spreadsheetId) {
    return res.status(400).json({ error: 'Spreadsheet ID not configured' });
  }
  
  const tradeId = req.params.id;
  const updatedTrade = req.body;
  
  try {
    const sheets = getSheetsService();
    const spreadsheetId = appConfig.spreadsheetId;
    const sheetName = appConfig.sheetName;
    
    // Fetch all values to find the row index
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:M`,
    });
    
    const rows = response.data.values;
    if (!rows) {
      return res.status(404).json({ error: 'No data found in sheet' });
    }
    
    // Find row by Trade ID (column A)
    const rowIndex = rows.findIndex(row => row[0] === tradeId);
    if (rowIndex === -1) {
      return res.status(404).json({ error: 'Trade ID not found in sheet' });
    }
    
    // Re-calculate P&L and ROI
    const entry = parseFloat(updatedTrade.entryPrice) || 0;
    const exit = parseFloat(updatedTrade.exitPrice) || 0;
    const size = parseFloat(updatedTrade.size) || 0;
    const fees = parseFloat(updatedTrade.fees) || 0;
    const action = updatedTrade.action || 'Long';
    
    let pnl = 0;
    let roi = 0;
    
    if (updatedTrade.status !== 'Open') {
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
    updatedTrade.id = tradeId; // Keep same ID
    
    const rowData = tradeToRow(updatedTrade);
    
    // RowIndex is 0-based. Google Sheets API range uses 1-based indexing.
    // So rowIndex 0 is A1:M1, rowIndex 1 is A2:M2.
    const updateRange = `${sheetName}!A${rowIndex + 1}:M${rowIndex + 1}`;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: updateRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [rowData]
      }
    });
    
    res.json({ success: true, trade: updatedTrade });
  } catch (err) {
    console.error('Error updating trade:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Delete a Trade
app.delete('/api/trades/:id', async (req, res) => {
  if (!appConfig.spreadsheetId) {
    return res.status(400).json({ error: 'Spreadsheet ID not configured' });
  }
  
  const tradeId = req.params.id;
  
  try {
    const sheets = getSheetsService();
    const spreadsheetId = appConfig.spreadsheetId;
    const sheetName = appConfig.sheetName;
    
    // Get sheets meta to get sheetId and find row index
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetInfo = meta.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheetInfo) {
      return res.status(404).json({ error: `Sheet tab '${sheetName}' not found` });
    }
    const sheetId = sheetInfo.properties.sheetId;
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:M`,
    });
    
    const rows = response.data.values;
    if (!rows) {
      return res.status(404).json({ error: 'No data found in sheet' });
    }
    
    // Find row by Trade ID (column A)
    const rowIndex = rows.findIndex(row => row[0] === tradeId);
    if (rowIndex === -1) {
      return res.status(404).json({ error: 'Trade ID not found in sheet' });
    }
    
    // Delete row via batchUpdate
    // rowIndex is 0-based index. In deleteDimension, startIndex is inclusive and endIndex is exclusive.
    // E.g. to delete rowIndex 2 (row 3 of sheet), startIndex = 2, endIndex = 3.
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
    
    res.json({ success: true, message: `Trade ${tradeId} deleted successfully.` });
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
