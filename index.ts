import fs from 'fs/promises'
import { spawn } from 'child_process'

const filePath = './chrome.DMP'
const qpdfHome = 'C:\\Program Files\\qpdf 11.6.1'

async function recover (filename: string) {
  console.log(`Recovering ${filename}`)

  const env = process.env
  env.PATH = `${env.PATH};${qpdfHome}/bin`

  const qpdf = spawn('qpdf', ['--linearize', '--remove-unreferenced-resources=yes', `./temp/${filename}.pdf`, `./result/${filename}.pdf`], { env })
  return await new Promise<void>((resolve, reject) => {
    qpdf.on('close', (code) => {
      // https://qpdf.readthedocs.io/en/stable/cli.html#exit-status
      // 0: no errors or warnings were found
      // 1: not used
      // 2: errors were found; the file was not processed
      // 3: warnings were found without errors
      if (code === 2) {
        console.log(`Failed to recover ${filename}`)
        reject()
        return
      }

      console.log(`Recovered ${filename}`)
      resolve()
    })
  })
}

async function main () {
  // Read file
  const buffer = await fs.readFile(filePath)

  // Find PDF header
  const signature = '%PDF-'
  const offsets: number[] = []
  while (true) {
    const offset = buffer.indexOf(signature, (offsets[offsets.length - 1] ?? 0) + 1)
    if (offset === -1) {
      break
    }
    offsets.push(offset)
  }

  // Filter out false positives
  const pdfs = offsets.filter(offset => {
    const header = buffer.toString('utf-8', offset, offset + 8)
    const version = parseFloat(header.replace(signature, ''))

    return !(isNaN(version) || Number.isInteger(version))
  }).map(offset => {
    return buffer.subarray(offset)
  })

  // Split PDFs by EOF
  const pdfsBeforeEOF = pdfs.map(pdf => {
    const eofOffsets: number[] = []
    while (true) {
      const offset = pdf.indexOf('%%EOF', (eofOffsets[eofOffsets.length - 1] ?? 0) + 1)
      if (offset === -1) {
        break
      }
      eofOffsets.push(offset)
    }

    return eofOffsets.map(eofOffset => {
      return pdf.subarray(0, eofOffset + 5)
    })
  }).flat()

  // Write temporary PDFs to disk
  await fs.mkdir('./temp', { recursive: true })
  await Promise.all(pdfsBeforeEOF.map((pdf, index) => {
    return fs.writeFile(`./temp/${index}.pdf`, pdf)
  }))


  await fs.mkdir('./result', { recursive: true })

  // Recover PDFs
  await Promise.allSettled(pdfsBeforeEOF.map((pdf, index) => {
    return recover(`${index}`)
  }))

  // Remove temporary PDFs
  await fs.rm('./temp', { recursive: true })
}

main().catch(console.error)
