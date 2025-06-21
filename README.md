

# PII Redactor Tool

A minimal web tool to detect and redact Personally Identifiable Information (PII) such as email addresses, phone numbers, names, and addresses from PDF and TXT files.

## Features
- Accepts PDF or TXT input
- Detects and redacts PII using regex, LLMs (Gemini), or hybrid logic
- Displays both original and redacted outputs
- Shows a table of what was removed, with type, value, and reason
- Allows export of the redacted output as PDF or TXT

This tool is designed for privacy-focused document review and redaction with a simple, functional interface.

## Roadmap
- [x] PDF and TXT support
- [x] Regex-based PII detection
- [x] Download as TXT or PDF
- [ ] OCR for scanned PDFs/images
- [ ] Gemini LLM integration for smarter PII detection
- [ ] DOC/DOCX support

## License
MIT
