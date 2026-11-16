/**
 * gdoc — Run: npx tsx src/lib/compliance/gdoc.test.ts
 */
import assert from 'node:assert/strict'
import { gdocErrorMessage, parseGdocId } from './gdoc'

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aB'
assert.equal(parseGdocId(`https://docs.google.com/document/d/${ID}/edit`), ID)
assert.equal(parseGdocId(`https://docs.google.com/document/d/${ID}/edit?tab=t.0#heading=h.x`), ID)
assert.equal(parseGdocId(`  https://docs.google.com/document/d/${ID}  `), ID)
assert.equal(parseGdocId(`https://docs.google.com/document/u/1/d/${ID}/edit`), ID)
assert.equal(parseGdocId(ID), ID)
assert.equal(parseGdocId(`http://docs.google.com/document/d/${ID}/edit`), null)
assert.equal(parseGdocId(`https://evil.com/document/d/${ID}/edit`), null)
assert.equal(parseGdocId(`https://docs.google.com.evil.com/document/d/${ID}/edit`), null)
assert.equal(parseGdocId(`https://docs.google.com@evil.com/document/d/${ID}/edit`), null)
assert.equal(parseGdocId(`https://docs.google.com/spreadsheets/d/${ID}/edit`), null)
assert.equal(parseGdocId('https://docs.google.com/document/d/short/edit'), null)
assert.equal(parseGdocId('short'), null)
assert.equal(parseGdocId(''), null)

assert.match(gdocErrorMessage({ code: 403 }, 'sa@x.iam'), /แชร์ไฟล์ให้ sa@x\.iam เป็น Editor/)
assert.match(gdocErrorMessage({ code: 404 }, ''), /Editor/)
assert.match(gdocErrorMessage({ message: 'Google Drive API has not been used in project 1' }, 'a'), /Drive API/)
console.log('gdoc tests passed')
