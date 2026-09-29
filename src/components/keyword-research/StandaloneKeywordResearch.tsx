'use client';

/**
 * Keyword Research (Standalone) — หน้าใหม่ ไม่ผูกกับโปรเจกต์ SEO SME
 *
 * mount WordGodOnlinePanel/WordGodLocalPanel เดียวกับที่ใช้ใน WordGodTab แต่ส่ง
 * project สังเคราะห์ (id ว่าง) + โหมด standalone — ผลลัพธ์ไม่บันทึกลง Keyword Bank
 * ของโปรเจกต์ใด ๆ ผู้ใช้เลือกส่งต่อไปหน้า Keyword ของลูกค้า Upload Article เอง
 * ผ่าน POST /api/upload-article/clients/[id]/keywords (REUSE ไม่สร้างระบบใหม่)
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import WordGodOnlinePanel from '@/components/projects/WordGodOnlinePanel';
import WordGodLocalPanel from '@/components/projects/WordGodLocalPanel';
import type { LanguageMode } from '@/lib/keyword-language';
import type { KeywordHandoffRow } from '@/lib/wordgod/intent-skill/handoff';
import { toUploadKeywordItems } from '@/lib/wordgod/intent-skill/handoff';

type ResearchMode = 'online' | 'local';

interface UploadClientListItem {
  id: string;
  name: string;
  website: string;
}

interface SendResult {
  added: number;
  updated: number;
  skipped: number;
  clientId: string;
}

const MODE_STORAGE_KEY = 'keyword-research:mode';
const SEND_CHUNK_SIZE = 500;

// project สังเคราะห์ — ไม่ผูกกับ SEO SME project จริง (id ว่าง = ไม่มีการบันทึกลง Keyword Bank)
const SYNTHETIC_PROJECT = { id: '', name: '', website: '', businessType: '' };

function loadStoredMode(): ResearchMode | null {
  try {
    const v = window.localStorage.getItem(MODE_STORAGE_KEY);
    return v === 'local' || v === 'online' ? v : null;
  } catch {
    return null;
  }
}

function storeMode(mode: ResearchMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* เงียบ — ไม่บล็อก UX ถ้าบันทึกไม่สำเร็จ */
  }
}

/** สลับระหว่างโหมดไม่มีหน้าร้าน (ออนไลน์) กับโหมดมีหน้าร้าน (Local) */
function ModeSwitch({ mode, onChange }: { mode: ResearchMode; onChange: (next: ResearchMode) => void }) {
  const options: Array<{ key: ResearchMode; label: string; hint: string }> = [
    { key: 'online', label: 'ไม่มีหน้าร้าน (ออนไลน์)', hint: 'หา keyword ที่มีโอกาสขายของธุรกิจออนไลน์' },
    { key: 'local', label: 'มีหน้าร้าน (Local)', hint: 'เน้น keyword + ทำเล — เขต อำเภอ สถานี ที่ลูกค้าใช้ค้นหา' },
  ];
  return (
    <div className="inline-grid w-full max-w-2xl grid-cols-2 gap-1 rounded-xl bg-[#eef1f7] p-1">
      {options.map(option => (
        <button
          key={option.key}
          onClick={() => onChange(option.key)}
          title={option.hint}
          className={`rounded-lg px-4 py-2 text-left transition ${
            mode === option.key ? 'bg-white shadow-sm' : 'hover:bg-white/50'
          }`}
        >
          <span className={`block text-xs font-semibold ${mode === option.key ? 'text-[#0d4fd8]' : 'text-[#606f8c]'}`}>{option.label}</span>
          <span className="mt-0.5 block text-[10px] font-normal leading-4 text-[#71809c]">{option.hint}</span>
        </button>
      ))}
    </div>
  );
}

const MODE_OPTIONS: Array<{ id: LanguageMode; label: string }> = [
  { id: 'th', label: 'ไทยเท่านั้น' },
  { id: 'en', label: 'อังกฤษเท่านั้น' },
  { id: 'both', label: 'ไทย+อังกฤษ' },
];

/** ตัวเลือกโหมดภาษา — local state ล้วน ไม่ผูกกับโปรเจกต์ (หน้านี้ไม่มี project จริงให้บันทึกค่า) */
function LanguageModeLocalSelect({
  value,
  ratioThai,
  onChangeMode,
  onChangeRatio,
}: {
  value: LanguageMode;
  ratioThai: number;
  onChangeMode: (mode: LanguageMode) => void;
  onChangeRatio: (ratio: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-600">ภาษา:</span>
        {MODE_OPTIONS.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChangeMode(opt.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              value === opt.id
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {value === 'both' && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 w-32 shrink-0">ไทย {ratioThai}% / อังกฤษ {100 - ratioThai}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={ratioThai}
            onChange={e => onChangeRatio(Number(e.target.value))}
            className="flex-1 h-1.5 accent-gray-800 cursor-pointer"
          />
        </div>
      )}
    </div>
  );
}

export default function StandaloneKeywordResearch() {
  const [mode, setMode] = useState<ResearchMode>('online');
  const [languageMode, setLanguageMode] = useState<LanguageMode>('th');
  const [ratioThai, setRatioThai] = useState(50);

  // send-to-Upload-Article modal state
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [pendingRows, setPendingRows] = useState<KeywordHandoffRow[]>([]);
  const [clients, setClients] = useState<UploadClientListItem[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [onlyApproved, setOnlyApproved] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  useEffect(() => {
    const stored = loadStoredMode();
    if (stored) setMode(stored);
  }, []);

  function handleModeChange(next: ResearchMode): void {
    setMode(next);
    storeMode(next);
  }

  const hasApprovedInfo = useMemo(() => pendingRows.some(r => r.approved !== null), [pendingRows]);
  const rowsToSend = useMemo(
    () => (onlyApproved ? pendingRows.filter(r => r.approved === true) : pendingRows),
    [pendingRows, onlyApproved]
  );
  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c => c.name.toLowerCase().includes(q) || (c.website || '').toLowerCase().includes(q));
  }, [clients, clientSearch]);

  function closeSendModal(): void {
    setSendModalOpen(false);
    setPendingRows([]);
    setClients([]);
    setClientSearch('');
    setSelectedClientId(null);
    setOnlyApproved(false);
    setSendResult(null);
  }

  async function handleSendRows(rows: KeywordHandoffRow[]): Promise<void> {
    const validRows = rows.filter(r => r.keyword.trim());
    if (validRows.length === 0) {
      toast.error('ไม่มี keyword ให้ส่ง');
      return;
    }
    setPendingRows(validRows);
    setSendResult(null);
    setSelectedClientId(null);
    setOnlyApproved(validRows.some(r => r.approved !== null));
    setSendModalOpen(true);
    setClientsLoading(true);
    try {
      const response = await fetch('/api/upload-article/clients');
      if (!response.ok) throw new Error('โหลดรายชื่อลูกค้าไม่สำเร็จ');
      const data = await response.json();
      setClients(Array.isArray(data) ? data.map((c: UploadClientListItem) => ({ id: c.id, name: c.name, website: c.website })) : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดรายชื่อลูกค้าไม่สำเร็จ');
    } finally {
      setClientsLoading(false);
    }
  }

  async function confirmSend(): Promise<void> {
    if (!selectedClientId) {
      toast.error('กรุณาเลือกลูกค้า');
      return;
    }
    if (rowsToSend.length === 0) {
      toast.error('ไม่มี keyword ให้ส่ง');
      return;
    }
    setSending(true);
    try {
      const items = toUploadKeywordItems(rowsToSend);
      let added = 0;
      let updated = 0;
      let skipped = 0;
      for (let i = 0; i < items.length; i += SEND_CHUNK_SIZE) {
        const batch = items.slice(i, i + SEND_CHUNK_SIZE);
        const response = await fetch(`/api/upload-article/clients/${selectedClientId}/keywords`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: batch }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `ส่งไม่สำเร็จ (HTTP ${response.status})`);
        added += data.added ?? 0;
        updated += data.updated ?? 0;
        skipped += data.skipped ?? 0;
      }
      setSendResult({ added, updated, skipped, clientId: selectedClientId });
      toast.success(`ส่งสำเร็จ — เพิ่มใหม่ ${added} • อัปเดต ${updated} • ข้าม ${skipped}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ส่งไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f9fd] text-[#17233a]">
      <div className="mx-auto max-w-[1600px] px-4 pt-6 pb-2">
        <h1 className="text-xl font-bold text-[#17233a]">Keyword Research</h1>
        <p className="mt-1 text-sm text-[#606f8c]">
          หา keyword ใหม่ วิเคราะห์ intent/จัดกลุ่ม แล้ว export หรือส่งต่อไปหน้า Keyword ของ Upload Article —
          ไม่ผูกกับโปรเจกต์ SEO SME
        </p>
      </div>

      <div className="mx-auto max-w-[1600px] px-4 space-y-3">
        <ModeSwitch mode={mode} onChange={handleModeChange} />
        <LanguageModeLocalSelect
          value={languageMode}
          ratioThai={ratioThai}
          onChangeMode={setLanguageMode}
          onChangeRatio={setRatioThai}
        />
      </div>

      {mode === 'local' ? (
        <WordGodLocalPanel
          project={SYNTHETIC_PROJECT}
          languageMode={languageMode}
          standalone
          onSendRows={handleSendRows}
          sendLabel="ส่งไป Upload Article"
        />
      ) : (
        <WordGodOnlinePanel
          project={SYNTHETIC_PROJECT}
          languageMode={languageMode}
          ratioThai={ratioThai}
          standalone
          onSendRows={handleSendRows}
          sendLabel="ส่งไป Upload Article"
        />
      )}

      {sendModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#dbe1ee] bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#17233a]">ส่งไป Upload Article</h2>
              <button
                onClick={closeSendModal}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="ปิด"
              >
                ✕
              </button>
            </div>

            {!sendResult ? (
              <>
                <p className="mt-2 text-sm text-[#495975]">
                  จะส่ง <span className="font-semibold">{rowsToSend.length}</span> คำ (จากทั้งหมด {pendingRows.length} คำ) ไปยังลูกค้าที่เลือก
                </p>

                {hasApprovedInfo && (
                  <label className="mt-3 flex items-center gap-2 text-sm text-[#17233a]">
                    <input
                      type="checkbox"
                      checked={onlyApproved}
                      onChange={e => setOnlyApproved(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    ส่งเฉพาะที่อนุมัติ (Approved)
                  </label>
                )}

                <div className="mt-3">
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    placeholder="ค้นหาลูกค้า..."
                    className="w-full rounded-xl border border-[#cfd9ea] bg-white px-3.5 py-2.5 text-sm text-[#17233a] placeholder:text-[#91a0b8] shadow-sm outline-none transition focus:border-[#155eef] focus:ring-4 focus:ring-[#155eef]/10"
                  />
                </div>

                <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-[#dbe1ee]">
                  {clientsLoading ? (
                    <div className="p-4 text-center text-sm text-[#91a0b8]">กำลังโหลดรายชื่อลูกค้า...</div>
                  ) : filteredClients.length === 0 ? (
                    <div className="p-4 text-center text-sm text-[#91a0b8]">ไม่พบลูกค้า</div>
                  ) : (
                    filteredClients.map(client => (
                      <button
                        key={client.id}
                        onClick={() => setSelectedClientId(client.id)}
                        className={`flex w-full flex-col items-start gap-0.5 border-b border-[#eef1f7] px-3.5 py-2.5 text-left last:border-b-0 transition ${
                          selectedClientId === client.id ? 'bg-[#eef4ff]' : 'hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-sm font-semibold text-[#17233a]">{client.name}</span>
                        {client.website && <span className="text-xs text-[#91a0b8]">{client.website}</span>}
                      </button>
                    ))
                  )}
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={closeSendModal}
                    className="rounded-lg border border-[#cfd9ea] px-4 py-2 text-sm font-medium text-[#495975] hover:bg-gray-50"
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={confirmSend}
                    disabled={!selectedClientId || sending || rowsToSend.length === 0}
                    className="rounded-lg bg-[#155eef] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0d4fd8] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sending ? 'กำลังส่ง...' : 'ส่ง'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-3 rounded-xl bg-[#eef4ff] p-4 text-sm text-[#17233a]">
                  ส่งสำเร็จ — เพิ่มใหม่ <span className="font-semibold">{sendResult.added}</span> · อัปเดต{' '}
                  <span className="font-semibold">{sendResult.updated}</span> · ข้าม{' '}
                  <span className="font-semibold">{sendResult.skipped}</span>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={closeSendModal}
                    className="rounded-lg border border-[#cfd9ea] px-4 py-2 text-sm font-medium text-[#495975] hover:bg-gray-50"
                  >
                    ปิด
                  </button>
                  <Link
                    href={`/upload-article/${sendResult.clientId}?tab=keyword`}
                    className="rounded-lg bg-[#155eef] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#0d4fd8]"
                  >
                    เปิดหน้า Keyword ของลูกค้า
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
