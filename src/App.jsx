import React, { useState } from 'react'
import './App.css'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import axios from 'axios';

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

  // Helper: Extract text from PDF using pdfjs-dist
  const extractTextFromPDF = async (file) => {
    setStatus('Extracting text from PDF...')
    setPdfProgress(0)
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    console.log('PDF loaded. Number of pages:', pdf.numPages)
    let text = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      console.log(`Page ${i} content:`, content.items.map(item => item.str).join(' '))
      text += content.items.map(item => item.str).join(' ') + '\n'
      setPdfProgress(Math.round((i / pdf.numPages) * 100))
    }
    setPdfProgress(100)
    return text
  }

  // Handle file upload and extract text
  const handleFileChange = async (file) => {
    setFile(file)
    setRedactedFileUrl(null)
    setFileText('')
    setStatus('Reading file...')
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    try {
      if (ext === 'txt') {
        const text = await file.text()
        setFileText(text)
        setStatus('Text file loaded.')
      } else if (ext === 'pdf') {
        const text = await extractTextFromPDF(file)
        setFileText(text)
        setStatus('PDF text extracted.')
      } else {
        setStatus('Unsupported file type. Only PDF and TXT are supported.')
      }
    } catch (err) {
      console.error('PDF/Text extraction error:', err)
      setStatus('Error reading file.')
    }
  }

  // Regex-based PII redaction (now tracks what was removed)
  const redactPII = (text, options = { email: true, phone: true, name: true, address: true }, labelStyle = 'default') => {
    let redacted = text
    const items = []
    let emailCount = 1, phoneCount = 1, nameCount = 1, addressCount = 1
    // Email
    if (options.email) {
      redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (match) => {
        items.push({ type: 'Email', value: match, reason: 'Matched regex for email' })
        return labelStyle === 'numbered' ? `[EMAIL_${emailCount++}]` : '[REDACTED EMAIL]'
      })
    }
    // Phone
    if (options.phone) {
      redacted = redacted.replace(/(\+\d{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4,6}/g, (match) => {
        items.push({ type: 'Phone', value: match, reason: 'Matched regex for phone' })
        return labelStyle === 'numbered' ? `[PHONE_${phoneCount++}]` : '[REDACTED PHONE]'
      })
    }
    // Name (improved to catch single, double, and triple capitalized names)
    if (options.name) {
      // First, redact three-word names (e.g., Soni Jay Gaurang)
      redacted = redacted.replace(/\b([A-Z][a-z]+\s[A-Z][a-z]+\s[A-Z][a-z]+)\b/g, (match) => {
        items.push({ type: 'Name', value: match, reason: 'Matched regex for three-word name' })
        return labelStyle === 'numbered' ? `[NAME_${nameCount++}]` : '[REDACTED NAME]'
      })
      // Then, redact two-word names (e.g., Soni Jay)
      redacted = redacted.replace(/\b([A-Z][a-z]+\s[A-Z][a-z]+)\b/g, (match) => {
        items.push({ type: 'Name', value: match, reason: 'Matched regex for two-word name' })
        return labelStyle === 'numbered' ? `[NAME_${nameCount++}]` : '[REDACTED NAME]'
      })
      // Finally, redact single capitalized words (e.g., Gaurang)
      redacted = redacted.replace(/\b([A-Z][a-z]{2,})\b/g, (match) => {
        items.push({ type: 'Name', value: match, reason: 'Matched regex for single-word name' })
        return labelStyle === 'numbered' ? `[NAME_${nameCount++}]` : '[REDACTED NAME]'
      })
    }
    // Address (very basic, numbers followed by street, not perfect)
    if (options.address) {
      redacted = redacted.replace(/\b\d{1,5}\s+([A-Za-z0-9.,\s]+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Blvd|Boulevard|Drive|Dr|Court|Ct)\b)/gi, (match) => {
        items.push({ type: 'Address', value: match, reason: 'Matched regex for address' })
        return labelStyle === 'numbered' ? `[ADDRESS_${addressCount++}]` : '[REDACTED ADDRESS]'
      })
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
    const page = pdfDoc.addPage()
    const { width, height } = page.getSize()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontSize = 12
    // Split text into lines that fit the page width
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
        page.drawText('...continued', { x: 40, y, size: fontSize, font })
        break
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
      {fileText && (
        <div style={{ display: 'flex', gap: '2rem', marginTop: '2rem', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h3>Original Text</h3>
            <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '6px', maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{fileText}</pre>
          </div>
          <div style={{ flex: 1 }}>
            <h3>Redacted Text</h3>
            <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '6px', maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{redactedText}</pre>
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
