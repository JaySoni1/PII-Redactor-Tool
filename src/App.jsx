import React, { useState } from 'react'
import './App.css'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import axios from 'axios';
import Tesseract from 'tesseract.js';

function App() {
  const [file, setFile] = useState(null)
  const [apiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY)
  const [status, setStatus] = useState('')
  const [redactedFileUrl, setRedactedFileUrl] = useState(null)
  const [fileText, setFileText] = useState('')
  const [useGemini, setUseGemini] = useState(false)
  const [redactedText, setRedactedText] = useState('')
  const [redactedItems, setRedactedItems] = useState([])
  const [pdfProgress, setPdfProgress] = useState(0)
  const [redactOptions, setRedactOptions] = useState({ email: true, phone: true, name: true, address: true })
  const [labelStyle, setLabelStyle] = useState('default')

  // Helper: Extract text from PDF using pdfjs-dist, fallback to OCR if needed
  const extractTextFromPDF = async (file) => {
    setStatus('Extracting text from PDF...')
    setPdfProgress(0)
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    let text = ''
    let ocrText = ''
    let extractedPages = 0

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items.map(item => item.str).join(' ')
      text += pageText + '\n'
      extractedPages++
      setPdfProgress(Math.round((i / pdf.numPages) * 100))
    }
    setPdfProgress(100)

    // If extracted text is too short (likely scanned PDF), fallback to OCR
    if (text.replace(/\s/g, '').length < 30) {
      setStatus('No selectable text found. Running OCR on scanned PDF...')
      text = ''
      setPdfProgress(0)
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale: 2.0 })
        // Create a canvas to render the page
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvasContext: context, viewport }).promise
        // Run OCR on the canvas image
        setStatus(`Running OCR on page ${i} of ${pdf.numPages}...`)
        const { data: { text: ocrResult } } = await Tesseract.recognize(
          canvas,
          'eng',
          {
            logger: m => {
              if (m.status === 'recognizing text') {
                setPdfProgress(Math.round((i - 1 + m.progress) / pdf.numPages * 100))
              }
            }
          }
        )
        text += ocrResult + '\n'
        setPdfProgress(Math.round((i / pdf.numPages) * 100))
      }
      setPdfProgress(100)
      setStatus('OCR extraction complete.')
    }
    return text
  }

  // Handle file upload and extract text
  const handleFileChange = async (file) => {
    setFile(file)
    setRedactedFileUrl(null)
    setFileText('')
    setRedactedText('')
    setRedactedItems([])
    setStatus('Reading file...')

    if (!file) {
      setStatus('No file selected.')
      return
    }

    const ext = file.name.split('.').pop().toLowerCase()
    try {
      let text = '';
      if (ext === 'txt') {
        text = await file.text()
        setStatus('Text file loaded.')
      } else if (ext === 'pdf') {
        text = await extractTextFromPDF(file)
        setStatus('PDF text extracted.')
      } else {
        setStatus('Unsupported file type. Only PDF and TXT are supported.')
        return;
      }
      setFileText(text)
    } catch (err) {
      console.error('Error reading file:', err)
      setStatus('Error reading file. See console for details.')
    }
  }

  // Regex-based PII redaction (now tracks what was removed)
  const redactPII = (text, options = { email: true, phone: true, name: true, address: true }, labelStyle = 'default') => {
    let redacted = text
    const items = []
    let emailCount = 1, phoneCount = 1, nameCount = 1, addressCount = 1
    // Add a list of common English words to avoid as names
    const stopwords = [
      'The', 'This', 'That', 'From', 'Other', 'And', 'But', 'With', 'For', 'Not', 'You', 'Your', 'Dear', 'Best', 'Regards', 'Subject', 'Date', 'To', 'Cc', 'Bcc', 'Hi', 'Hello', 'Thanks', 'Thank', 'Please', 'No', 'Yes', 'It', 'We', 'Us', 'He', 'She', 'They', 'His', 'Her', 'Their', 'Our', 'My', 'Me', 'I', 'In', 'On', 'At', 'By', 'Of', 'As', 'Is', 'Are', 'Be', 'Was', 'Were', 'Do', 'Did', 'Has', 'Have', 'Had', 'Will', 'Shall', 'Can', 'Could', 'Would', 'Should', 'May', 'Might', 'Must', 'If', 'Else', 'Then', 'So', 'Or', 'An', 'A',
      // Add more common English nouns/adjectives/adverbs to further reduce false positives
      'Access', 'System', 'Risk', 'Management', 'Finance', 'Operations', 'Compliance', 'Legal', 'Audit', 'Procurement', 'Sales', 'Marketing', 'Human', 'Resources', 'IT', 'Technology', 'Security', 'Planning', 'Strategy', 'Quality', 'Control', 'Assurance', 'User', 'Role', 'Permission', 'Credentials', 'Login', 'Logout', 'Profile', 'Data', 'Record', 'Primary', 'Secondary', 'Info', 'Information', 'Details', 'Account', 'Accounts', 'Customer', 'Service', 'Support', 'Manager', 'Admin', 'Administrator', 'Department', 'Team', 'Division', 'Organization', 'Company', 'Office', 'Branch', 'Unit', 'Section', 'Committee', 'Board', 'Group'
    ]
    // Add a list of common first and last names for more accurate detection
    const commonFirstNames = [
      'James','Mary','John','Patricia','Robert','Jennifer','Michael','Linda','William','Elizabeth','David','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen','Christopher','Nancy','Daniel','Lisa','Matthew','Betty','Anthony','Margaret','Mark','Sandra','Donald','Ashley','Steven','Kimberly','Paul','Emily','Andrew','Donna','Joshua','Michelle','Kenneth','Dorothy','Kevin','Carol','Brian','Amanda','George','Melissa','Edward','Deborah','Ronald','Stephanie','Timothy','Rebecca','Jason','Sharon','Jeffrey','Laura','Ryan','Cynthia','Jacob','Kathleen','Gary','Amy','Nicholas','Shirley','Eric','Angela','Stephen','Helen','Jonathan','Anna','Larry','Brenda','Justin','Pamela','Scott','Nicole','Brandon','Emma','Benjamin','Samantha','Samuel','Katherine','Gregory','Christine','Frank','Debra','Alexander','Rachel','Raymond','Catherine','Patrick','Carolyn','Jack','Janet','Dennis','Ruth','Jerry','Maria'
    ]
    const commonLastNames = [
      'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts'
    ]
    // Add a stoplist for department/team/organization words
    const orgStopwords = [
      'Department', 'Team', 'Division', 'Organization', 'Company', 'Office', 'Branch', 'Unit', 'Section', 'Committee', 'Board', 'Group',
      'Account', 'Details', 'Accounts', 'Information', 'Customer', 'Service', 'Support', 'Manager', 'Admin', 'Administrator', 'Dear',
      'Primary', 'Secondary', 'Info', 'Information',
      // Add more business/role/label words to avoid false positives
      'Risk', 'Management', 'Finance', 'Operations', 'Compliance', 'Legal', 'Audit', 'Procurement', 'Sales', 'Marketing', 'Human', 'Resources', 'IT', 'Technology', 'Security', 'Planning', 'Strategy', 'Quality', 'Control', 'Assurance',
      'System', 'Access', 'User', 'Role', 'Permission', 'Credentials', 'Login', 'Logout', 'Profile', 'Account', 'Data', 'Record'
    ];
    // Optionally, a whitelist for common single-word names
    const nameWhitelist = ['Smith', 'John', 'Jay', 'Michael', 'Chen', 'Wong', 'Kee', 'Jogn']; // Add more as needed

    // Email
    if (options.email) {
      redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (match) => {
        items.push({ type: 'Email', value: match, reason: 'Matched regex for email' })
        return labelStyle === 'numbered' ? `[EMAIL_${emailCount++}]` : '[REDACTED EMAIL]'
      })
    }
    // Phone
    if (options.phone) {
      // Exclude Tax ID and Social Security from phone redaction using negative lookbehind and negative lookahead
      redacted = redacted.replace(
        /(?<!Tax ID:\s)(?<!TaxID:\s)(?<!Tax Identification Number:\s)(?<!TIN:\s)(?<!Social Security:\s)(?<!SSN:\s)(?<!Social Security Number:\s)(?<!\d{2}-)(\+\d{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4,6}(?![-\d])/g,
        (match) => {
          items.push({ type: 'Phone', value: match, reason: 'Matched regex for phone' })
          return labelStyle === 'numbered' ? `[PHONE_${phoneCount++}]` : '[REDACTED PHONE]'
        }
      )
    }
    // Name (improved to catch single, double, and triple capitalized names)
    if (options.name) {
      // Redact names after common labels (e.g., "To:", "From:", "Department:")
      redacted = redacted.replace(/(To:\s*)([A-Z][a-z]+\s+[A-Z][a-z]+)/g, (match, p1, p2) => {
        const parts = p2.split(' ');
        if (parts.some(w => orgStopwords.includes(w))) return match;
        items.push({ type: 'Name', value: p2, reason: 'Matched name after To:' })
        return p1 + (labelStyle === 'numbered' ? `[NAME_${nameCount++}]` : '[REDACTED NAME]')
      })
      redacted = redacted.replace(/(From:\s*)([A-Z][a-z]+\s+[A-Z][a-z]+)/g, (match, p1, p2) => {
        const parts = p2.split(' ');
        if (parts.some(w => orgStopwords.includes(w))) return match;
        items.push({ type: 'Name', value: p2, reason: 'Matched name after From:' })
        return p1 + (labelStyle === 'numbered' ? `[NAME_${nameCount++}]` : '[REDACTED NAME]')
      })
      redacted = redacted.replace(/(Department:\s*)([A-Z][a-z]+\s+[A-Z][a-z]+)/g, (match, p1, p2) => {
        const parts = p2.split(' ');
        if (parts.some(w => orgStopwords.includes(w))) return match;
        items.push({ type: 'Name', value: p2, reason: 'Matched name after Department:' })
        return p1 + (labelStyle === 'numbered' ? `[NAME_${nameCount++}]` : '[REDACTED NAME]')
      })
      // Improved: Redact three-word names, only if first and last are common names, skip if any word is in orgStopwords or stopwords
      redacted = redacted.replace(
        /\b([A-Z][a-zA-Z'’-]{2,})\s+([A-Z][a-zA-Z'’-]{2,})\s+([A-Z][a-zA-Z'’-]{2,})\b/g,
        (match, w1, w2, w3) => {
          if ([w1, w2, w3].some(w => orgStopwords.includes(w) || stopwords.includes(w))) return match;
          // Only redact if first or last is a common name
          if (
            (commonFirstNames.includes(w1) && commonLastNames.includes(w3)) ||
            (commonFirstNames.includes(w1) && commonFirstNames.includes(w2)) ||
            (commonLastNames.includes(w2) && commonLastNames.includes(w3))
          ) {
            items.push({ type: 'Name', value: match, reason: 'Matched likely three-word name' })
            return labelStyle === 'numbered' ? `[NAME_${nameCount++}]` : '[REDACTED NAME]'
          }
          return match;
        }
      )
      // Improved: Redact two-word names, only if first or last is a common name, skip if any word is in orgStopwords or stopwords
      redacted = redacted.replace(
        /\b([A-Z][a-zA-Z'’-]{2,})\s+([A-Z][a-zA-Z'’-]{2,})\b/g,
        (match, w1, w2) => {
          if ([w1, w2].some(w => orgStopwords.includes(w) || stopwords.includes(w))) return match;
          // Only redact if either word is a common first or last name
          if (commonFirstNames.includes(w1) || commonLastNames.includes(w2)) {
            items.push({ type: 'Name', value: match, reason: 'Matched likely two-word name' })
            return labelStyle === 'numbered' ? `[NAME_${nameCount++}]` : '[REDACTED NAME]'
          }
          return match;
        }
      )
      // Optional: Redact single-word names if in whitelist or common names
      redacted = redacted.replace(/\b([A-Z][a-zA-Z'’-]{2,})\b/g, (match) => {
        if (nameWhitelist.includes(match) || commonFirstNames.includes(match) || commonLastNames.includes(match)) {
          items.push({ type: 'Name', value: match, reason: 'Matched whitelist/common single-word name' })
          return labelStyle === 'numbered' ? `[NAME_${nameCount++}]` : '[REDACTED NAME]'
        }
        return match;
      })
    }
    // Address (stricter: numbers followed by street-type word only)
    if (options.address) {
      redacted = redacted.replace(
        /\b\d{1,5}\s+([A-Za-z0-9.,\s]+?\b(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Blvd|Boulevard|Drive|Dr|Court|Ct)\b)/gi,
        (match) => {
          items.push({ type: 'Address', value: match, reason: 'Matched regex for address' })
          return labelStyle === 'numbered' ? `[ADDRESS_${addressCount++}]` : '[REDACTED ADDRESS]'
        }
      )
    }
    setRedactedItems(items)
    return redacted
  }

  // Gemini LLM-based PII detection (now tracks what was removed)
  const redactPIIWithGemini = async (text) => {
    if (!apiKey) {
      setStatus('Gemini API key required for LLM redaction.')
      return text
    }
    setStatus('Contacting Gemini for PII detection...')
    const prompt = `Find and return all personally identifiable information (PII) in the following text as a JSON array of objects with 'text' and 'type'. Only return the JSON array.\n\n${text}`
    try {
      const response = await axios.post(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        {
          contents: [
            {
              parts: [
                { text: prompt }
              ]
            }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          }
        }
      )
      // Parse Gemini's response
      const candidates = response.data.candidates || []
      let piiList = []
      for (const cand of candidates) {
        const content = cand.content?.parts?.[0]?.text || ''
        try {
          // Try to extract JSON array from the response
          const match = content.match(/\[.*\]/s)
          if (match) {
            const arr = JSON.parse(match[0])
            piiList = piiList.concat(arr)
          }
        } catch (e) { /* ignore parse errors */ }
      }
      // Redact all detected PII
      let redacted = text
      const items = []
      if (piiList.length > 0) {
        piiList.forEach((pii, idx) => {
          if (pii.text) {
            items.push({ type: pii.type || 'PII', value: pii.text, reason: 'LLM detected as ' + (pii.type || 'PII') })
            const safeText = pii.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            redacted = redacted.replace(new RegExp(safeText, 'g'), `[REDACTED ${pii.type ? pii.type.toUpperCase() : 'PII'}_${idx + 1}]`)
          }
        })
      }
      setRedactedItems(items)
      return redacted
    } catch (err) {
      setStatus('Gemini API error. Falling back to regex redaction.')
      return redactPII(text)
    }
  }

  // Generate a PDF file from redacted text using pdf-lib
  const generatePdfFromText = async (text, fileName) => {
    // Clean text of unsupported Unicode characters that cause WinAnsi encoding errors
    const cleanText = text
      // Replace common problematic Unicode characters with ASCII equivalents
      .replace(/[\u25E6]/g, '-') // ◦ (bullet) -> dash
      .replace(/[\u2013\u2014]/g, '-') // en-dash, em-dash -> dash
      .replace(/[\u2018\u2019]/g, "'") // smart quotes -> simple quote
      .replace(/[\u201C\u201D]/g, '"') // smart quotes -> simple quote
      .replace(/[\u2022]/g, '-') // bullet -> dash
      .replace(/[\u2026]/g, '...') // ellipsis -> three dots
      .replace(/[\u00A0]/g, ' ') // non-breaking space -> regular space
      // Remove or replace other potentially problematic Unicode characters
      .replace(/[\u0080-\u009F]/g, '') // Control characters
      .replace(/[\u00AD]/g, '') // Soft hyphen
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width characters
      // Replace any remaining non-ASCII characters that might cause issues
      .replace(/[^\x00-\x7F]/g, (char) => {
        // Map common Unicode characters to ASCII equivalents
        const charMap = {
          'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a',
          'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
          'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
          'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
          'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
          'ñ': 'n', 'ç': 'c',
          'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'Ä': 'A', 'Å': 'A',
          'È': 'E', 'É': 'E', 'Ê': 'E', 'Ë': 'E',
          'Ì': 'I', 'Í': 'I', 'Î': 'I', 'Ï': 'I',
          'Ò': 'O', 'Ó': 'O', 'Ô': 'O', 'Õ': 'O', 'Ö': 'O',
          'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'Ü': 'U',
          'Ñ': 'N', 'Ç': 'C'
        };
        return charMap[char] || '?';
      });

    const pdfDoc = await PDFDocument.create()
    let page = pdfDoc.addPage()
    let { width, height } = page.getSize()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontSize = 12
    const maxWidth = width - 80
    const lines = []
    let currentLine = ''
    cleanText.split(/\r?\n/).forEach(paragraph => {
      paragraph.split(' ').forEach(word => {
        const testLine = currentLine ? currentLine + ' ' + word : word
        const testWidth = font.widthOfTextAtSize(testLine, fontSize)
        if (testWidth > maxWidth) {
          lines.push(currentLine)
          currentLine = word
        } else {
          currentLine = testLine
        }
      })
      if (currentLine) {
        lines.push(currentLine)
        currentLine = ''
      }
      lines.push('') // Paragraph break
    })
    let y = height - 40
    for (const line of lines) {
      if (y < 40) {
        // Add new page and reset y
        page = pdfDoc.addPage()
        y = height - 40
      }
      page.drawText(line, { x: 40, y, size: fontSize, font })
      y -= fontSize + 4
    }
    const pdfBytes = await pdfDoc.save()
    const blob = new Blob([pdfBytes], { type: 'application/pdf' })
    return URL.createObjectURL(blob)
  }

  // Handle Redact button
  const handleRedact = async () => {
    if (!fileText) {
      setStatus('No text to redact.')
      return
    }
    setStatus('Redacting PII...')
    let redacted
    if (useGemini && apiKey) {
      redacted = await redactPIIWithGemini(fileText)
    } else {
      redacted = redactPII(fileText, redactOptions, labelStyle)
    }
    setRedactedText(redacted)
    setStatus('PII redacted. Ready to download.')
    // Always generate PDF
    const url = await generatePdfFromText(redacted, file.name)
    setRedactedFileUrl(url)
  }

  // Handle Download button
  const handleDownload = () => {
    if (!redactedFileUrl) return
    const ext = 'pdf'
    const downloadName = file.name.replace(/\.[^.]+$/, '') + '_redacted.' + ext
    const a = document.createElement('a')
    a.href = redactedFileUrl
    a.download = downloadName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className="app-container">
      <h1>PII Redactor Tool</h1>
      <div className="input-section">
        <label>
          Upload PDF or TXT:
          <input
            type="file"
            accept=".pdf,.txt"
            onChange={e => handleFileChange(e.target.files[0])}
          />
        </label>
      </div>
      <div className="input-section">
        <label>
          <input
            type="checkbox"
            checked={useGemini}
            onChange={e => setUseGemini(e.target.checked)}
          />
          Use Gemini LLM for PII detection
        </label>
      </div>
      <div className="input-section">
        <label>PII Types to Redact:</label>
        <label><input type="checkbox" checked={redactOptions.email} onChange={e => setRedactOptions(o => ({ ...o, email: e.target.checked }))}/> Email</label>
        <label><input type="checkbox" checked={redactOptions.phone} onChange={e => setRedactOptions(o => ({ ...o, phone: e.target.checked }))}/> Phone</label>
        <label><input type="checkbox" checked={redactOptions.name} onChange={e => setRedactOptions(o => ({ ...o, name: e.target.checked }))}/> Name</label>
        <label><input type="checkbox" checked={redactOptions.address} onChange={e => setRedactOptions(o => ({ ...o, address: e.target.checked }))}/> Address</label>
      </div>
      <div className="input-section">
        <label>Redaction Label Style:
          <select value={labelStyle} onChange={e => setLabelStyle(e.target.value)}>
            <option value="default">[REDACTED EMAIL]</option>
            <option value="numbered">[EMAIL_1], [PHONE_1], etc.</option>
          </select>
        </label>
      </div>
      <div className="button-section">
        <button disabled={!fileText} onClick={handleRedact}>Redact PII</button>
        <button disabled={!redactedFileUrl} onClick={handleDownload}>Download Redacted File</button>
      </div>
      <div className="status-section">
        <p>{status}</p>
        {status.startsWith('Extracting text from PDF') && (
          <div style={{ marginTop: 8 }}>
            <div style={{ background: '#e5e7eb', borderRadius: 6, height: 16, width: '100%', overflow: 'hidden' }}>
              <div style={{ width: `${pdfProgress}%`, height: '100%', background: '#2563eb', transition: 'width 0.2s' }} />
            </div>
            <div style={{ fontSize: 12, color: '#2563eb', marginTop: 2 }}>{pdfProgress}%</div>
          </div>
        )}
      </div>

      {/* Show original and redacted text side by side */}
      {file && (
        <div style={{ display: 'flex', gap: '2rem', marginTop: '2rem', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h3>Original Text</h3>
            <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '6px', maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {fileText || 'Processing file...'}
            </pre>
          </div>
          <div style={{ flex: 1 }}>
            <h3>Redacted Text</h3>
            <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '6px', maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {redactedText || 'Click "Redact PII" to see redacted text.'}
            </pre>
          </div>
        </div>
      )}

      {/* Show what was removed */}
      {redactedItems.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h3>Redacted Items</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #ddd', padding: '8px' }}>Type</th>
                <th style={{ border: '1px solid #ddd', padding: '8px' }}>Value</th>
                <th style={{ border: '1px solid #ddd', padding: '8px' }}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {redactedItems.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{item.type}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px', color: '#b91c1c' }}>{item.value}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px', color: '#555' }}>{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default App
