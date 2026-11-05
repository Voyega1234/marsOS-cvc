// ลายนิ้วมือน้ำเสียงใน Master Prompt: ไม่มีหัวข้อนี้ = prompt ของโปรเจกต์เดิมเท่าเดิมทุกตัวอักษร
import { VOICE_PROFILE_HEADING, voiceProfilePrecedenceLine } from './article-human-voice-skill'
import { buildWriterSystemPrompt } from './upload-article/writer'

let passed = 0
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
}

function main() {
  const layers = { businessSkill: 'B', articleBrief: 'A', validatorPack: 'V' }
  const plain = buildWriterSystemPrompt({ ...layers, masterPrompt: 'M' } as Parameters<typeof buildWriterSystemPrompt>[0])
  assert(plain === 'M\n\n# Business Skill\nB\n\n# Article Brief\nA\n\n# Validator Pack (ตรวจตัวเองก่อนส่ง)\nV', 'Master เก่า ได้ system prompt เท่าเดิม')
  assert(voiceProfilePrecedenceLine('M') === '', 'ไม่มีหัวข้อ = ว่าง')
  assert(voiceProfilePrecedenceLine('') === '', 'ข้อความว่าง = ว่าง')
  assert(voiceProfilePrecedenceLine(null) === '', 'null = ว่าง')
  assert(voiceProfilePrecedenceLine('ลายนิ้วมือน้ำเสียง อย่างเดียว') === '', 'ต้องตรงหัวข้อเต็ม ไม่ใช่แค่คำ')

  const master = `M\n${VOICE_PROFILE_HEADING}\nผู้พูด: คลินิก`
  const withVoice = buildWriterSystemPrompt({ ...layers, masterPrompt: master } as Parameters<typeof buildWriterSystemPrompt>[0])
  const line = voiceProfilePrecedenceLine(master)
  assert(line.startsWith('- [BLOCKING]'), 'มีหัวข้อ = มีบรรทัดลำดับ')
  assert(withVoice.endsWith(`V\n${line}`), 'บรรทัดลำดับอยู่ท้ายสุด ต่อจาก Validator')
  assert(line.indexOf('ข้อจำกัด') < line.indexOf('Comment จากลูกค้า'), 'ข้อจำกัดมาก่อน Comment')
  assert(line.indexOf('Comment จากลูกค้า') < line.indexOf('"ลายนิ้วมือน้ำเสียง"'), 'Comment มาก่อนลายนิ้วมือ')

  const note = buildWriterSystemPrompt({ ...layers, masterPrompt: master, restrictionsNote: 'N' } as Parameters<typeof buildWriterSystemPrompt>[0])
  assert(note.endsWith(`V\nN\n${line}`), 'บรรทัดลำดับอยู่หลังบรรทัดตรวจข้อจำกัด')
  console.log(`voice-profile: ${passed} passed`)
}

main()
