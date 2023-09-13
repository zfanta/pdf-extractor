import fs from 'fs/promises'
import { spawn } from 'child_process'
import { Option, Command, Argument } from 'commander'
import { resolve } from 'path'

const program = new Command()
  .addArgument(new Argument('file', 'Path to PDF file'))
  .addOption(new Option('-q, --qpdf [path]', 'Path to qpdf binary').default('qpdf'))
  .addOption(new Option('-t, --temp [path]', 'Path to temporary directory').default('./temp'))
  .addOption(new Option('-r, --result [path]', 'Path to result directory').default('./result'))
  .parse()

const options = program.opts() as {
  qpdf: string
  temp: string
  result: string
}

const filePath = program.args[0]

async function recover (filename: string) {
  console.log(`Recovering ${filename}`)

  const tempFilePath = resolve(options.temp, `${filename}.pdf`)
  const resultFilePath = resolve(options.result, `${filename}.pdf`)

  const qpdf = spawn(options.qpdf, ['--linearize', '--remove-unreferenced-resources=yes', tempFilePath, resultFilePath])
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
  await fs.mkdir(options.temp, { recursive: true })
  await Promise.all(pdfsBeforeEOF.map((pdf, index) => {
    const tempFilePath = resolve(options.temp, `${index}.pdf`)
    return fs.writeFile(tempFilePath, pdf)
  }))

  await fs.mkdir(options.result, { recursive: true })

  // Recover PDFs
  await Promise.allSettled(pdfsBeforeEOF.map((_, index) => {
    return recover(`${index}`)
  }))

  // Remove temporary PDFs
  await fs.rm(options.temp, { recursive: true })
}

main().catch(console.error)
