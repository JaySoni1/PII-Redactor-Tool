# PII Redactor Tool

A minimal web tool to detect and redact Personally Identifiable Information (PII) such as *email addresses, **phone numbers, **names, and **addresses* from PDF and TXT files.

---

## Features

- Accepts PDF or TXT input  
- Detects and redacts PII using Regex and Gemini LLM  
- Displays both *original* and *redacted* text  
- Shows a table of removed items with type, value, and reason  
- Export redacted output as *PDF*

## Implementation Overview

The tool is built using React and designed to be simple and privacy-focused. It works in two ways: using regex for PII detection and also supports Gemini LLM for smarter results.

-Built with a clean React UI
-Detects emails, phone numbers, names, and addresses using regex
-Shows original and redacted text side-by-side
-Supports Gemini LLM for advanced detection
-Allows downloading redacted files as PDF
-OCR for scanned PDFs/images (coming soon)
-DOC/DOCX file support (coming soon)

## Tool Workflow
![image](https://github.com/user-attachments/assets/16ac210e-6351-4d73-bdb0-7df85049c842) (Link -https://excalidraw.com/#json=I2HaqDXQvDNa3D8beCU90,nSvE49cCl691GIUsF1SxJA)

## Screenshots

### 1. Upload Your File 
![image](https://github.com/user-attachments/assets/797aae1d-ee88-4bd2-a69f-cca075d86d54)

### 2. Redacted Results and PII Summary  
![image](https://github.com/user-attachments/assets/9869b495-19b7-4c1e-9470-f90675d116d2)

### 3. Exported PDF Output
![image](https://github.com/user-attachments/assets/d131788a-9f03-46da-aa3c-bc64b964ae83)

## License

This project is licensed under the [MIT License](./LICENSE).
