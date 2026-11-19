"use client";

import { EmptyState, Panel } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { UntrackedBrandsDTO } from "@/lib/brand-radar/untracked-types";
import { ColumnHelp } from "./ColumnHelp";
import { ProviderLogo } from "./ProviderLogo";
import { fmtNum } from "./shared";

const HELP = {
  brand: {
    what: "ชื่อแบรนด์ที่ ChatGPT หรือ Gemini ติดป้ายไว้ในคำตอบ และเรายังไม่ได้ติดตามเป็นคู่แข่ง",
    how: "รวมชื่อที่สะกดต่างกันเล็กน้อย (ตัวพิมพ์เล็กใหญ่ ความกว้างตัวอักษร) เป็นแบรนด์เดียว แล้วแสดงการสะกดที่พบบ่อยที่สุด ตัดแบรนด์เราและคู่แข่งที่ติดตามอยู่ออก รวมถึงชื่อที่ซ้อนกัน เช่น Shopee Thailand เมื่อติดตาม Shopee อยู่",
    when: "คำนวณใหม่ทุกครั้งที่เปิดหน้านี้ ตามตัวกรองที่เลือก",
  },
  category: {
    what: "ประเภทของแบรนด์ตามที่แพลตฟอร์ม AI ระบุเอง",
    how: "ใช้ค่าที่พบบ่อยที่สุดของแบรนด์นั้น ถ้าแพลตฟอร์มไม่ระบุจะเว้นว่าง",
    when: "เปลี่ยนตามผลสแกนใหม่ของ ChatGPT และ Gemini",
  },
  answers: {
    what: "จำนวนคำตอบที่แพลตฟอร์มติดป้ายแบรนด์นี้ และสัดส่วนเทียบกับคำตอบที่มีป้ายแบรนด์ทั้งหมด",
    how: "นับคำตอบที่ไม่ซ้ำกัน ถ้าแบรนด์ถูกติดป้ายหลายครั้งในคำตอบเดียวนับเป็น 1 สัดส่วน = จำนวนคำตอบที่เอ่ยถึง หารด้วยคำตอบทั้งหมดในตัวกรองที่มีป้ายแบรนด์อย่างน้อย 1 ป้าย",
    when: "คำนวณใหม่ทุกครั้งที่เปิดหน้านี้ มีเฉพาะรอบสแกนตั้งแต่ 19 พ.ย. 69",
  },
  prompts: {
    what: "จำนวนคำถามที่มีคำตอบเอ่ยถึงแบรนด์นี้อย่างน้อย 1 ครั้ง",
    how: "นับคำถามที่ไม่ซ้ำกันจากคำตอบที่ติดป้ายแบรนด์นี้",
    when: "คำนวณใหม่ทุกครั้งที่เปิดหน้านี้ ตามตัวกรองที่เลือก",
  },
  providers: {
    what: "แพลตฟอร์ม AI ที่ติดป้ายแบรนด์นี้ในคำตอบ",
    how: "แสดงเฉพาะแพลตฟอร์มที่มีคำตอบติดป้ายแบรนด์นี้ในตัวกรองปัจจุบัน (ข้อมูลนี้มีเฉพาะ ChatGPT และ Gemini)",
    when: "เปลี่ยนตามผลสแกนใหม่",
  },
  samples: {
    what: "ตัวอย่างคำถามที่ทำให้ AI เอ่ยถึงแบรนด์นี้",
    how: "เลือกสูงสุด 3 คำถามที่มีคำตอบติดป้ายแบรนด์นี้มากที่สุด",
    when: "คำนวณใหม่ทุกครั้งที่เปิดหน้านี้",
  },
} as const;

export default function UntrackedBrandsSection({ data }: { data?: UntrackedBrandsDTO }) {
  if (!data) return null;
  return (
    <Panel
      title="คู่แข่งที่ยังไม่ได้ติดตาม"
      subtitle="แบรนด์อื่นที่ AI เอ่ยถึงในคำตอบ แต่ยังไม่อยู่ในรายชื่อคู่แข่งของเรา ข้อมูลมาจากป้ายแบรนด์ของ ChatGPT และ Gemini เท่านั้น และมีเฉพาะรอบสแกนตั้งแต่ 19 พ.ย. 69"
      padded={data.rows.length === 0}
    >
      {data.taggedAnswers === 0 ? (
        <EmptyState title="ยังไม่มีข้อมูล" description="ข้อมูลจะปรากฏหลังสแกนครั้งถัดไปด้วย ChatGPT หรือ Gemini" />
      ) : data.rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">แบรนด์ที่ AI เอ่ยถึงทั้งหมดอยู่ในรายชื่อที่ติดตามแล้ว</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead><ColumnHelp help={HELP.brand} align="start">แบรนด์</ColumnHelp></TableHead>
                  <TableHead><ColumnHelp help={HELP.category} align="start">ประเภท</ColumnHelp></TableHead>
                  <TableHead className="text-right"><ColumnHelp help={HELP.answers} align="end">คำตอบที่เอ่ยถึง</ColumnHelp></TableHead>
                  <TableHead className="text-right"><ColumnHelp help={HELP.prompts} align="end">คำถาม</ColumnHelp></TableHead>
                  <TableHead><ColumnHelp help={HELP.providers}>แพลตฟอร์ม</ColumnHelp></TableHead>
                  <TableHead><ColumnHelp help={HELP.samples} align="end">คำถามตัวอย่าง</ColumnHelp></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={`${r.name}|${r.domain}`}>
                    <TableCell className="max-w-[220px]">
                      <p className="break-words font-medium">{r.name}</p>
                      {r.domain ? <p className="break-all text-xs text-gray-500 dark:text-gray-400">{r.domain}</p> : null}
                    </TableCell>
                    <TableCell className="max-w-[160px] break-words text-sm text-gray-600 dark:text-gray-300">{r.category || "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNum(r.answers)}
                      <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">({((r.answers / data.taggedAnswers) * 100).toFixed(1)}%)</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(r.prompts)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.providers.map((p) => <ProviderLogo key={p} provider={p} size={18} />)}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <ul className="space-y-0.5 text-xs text-gray-600 dark:text-gray-300">
                        {r.samplePrompts.map((s) => (
                          <li key={s.promptId} className="line-clamp-2 break-words" title={s.text}>{s.text}</li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">อยากติดตามแบรนด์ไหน เพิ่มเป็นคู่แข่งได้ที่ Settings</p>
        </>
      )}
    </Panel>
  );
}
