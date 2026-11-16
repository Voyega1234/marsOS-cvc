/** ช่องทางคุยกับ Google Sheets ของโควต้า (เซิร์ฟเวอร์เท่านั้น) — แยกเป็น interface เพื่อให้เทสด้วยชีทจำลองได้ */
import { google } from "googleapis";
import { getSheetsServiceAuth } from "@/lib/google-auth";

export interface SheetTabInfo { sheetId: number; title: string; rowCount: number; columnCount: number }

export interface ReadTabsOptions { render?: "UNFORMATTED_VALUE" | "FORMULA" }

export interface SheetsPort {
  getSpreadsheet(spreadsheetId: string): Promise<{ title: string; tabs: SheetTabInfo[] }>;
  /**
   * ค่าดิบทั้งแท็บตั้งแต่แถว 1 (UNFORMATTED_VALUE + SERIAL_NUMBER)
   * render: "FORMULA" = เซลล์ที่เป็นสูตรคืนข้อความสูตร ("=...") แทนผลลัพธ์ — ใช้ตรวจก่อนเขียนทับ
   */
  readTabs(spreadsheetId: string, tabTitles: string[], opts?: ReadTabsOptions): Promise<Record<string, unknown[][]>>;
  writeCells(spreadsheetId: string, updates: { range: string; values: (string | number)[][]; mode: "RAW" | "USER_ENTERED" }[]): Promise<void>;
  /** คำสั่งเชิงโครงสร้าง (insertDimension / appendDimension / mergeCells / copyPaste ...) */
  batchUpdate(spreadsheetId: string, requests: object[]): Promise<void>;
}

const REQ_OPTS = { timeout: 20_000 };

/** ชื่อแท็บใน A1 ต้องครอบด้วย ' และ escape ' เป็น '' */
function quoteTab(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/** ของจริง: googleapis + service account (ไม่ log ข้อมูลรับรอง) */
export function googleSheetsPort(): SheetsPort {
  async function client() {
    const auth = await getSheetsServiceAuth();
    return google.sheets({ version: "v4", auth });
  }
  return {
    async getSpreadsheet(spreadsheetId) {
      const sheets = await client();
      const res = await sheets.spreadsheets.get(
        { spreadsheetId, fields: "properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))" },
        REQ_OPTS,
      );
      return {
        title: res.data.properties?.title ?? "",
        tabs: (res.data.sheets ?? []).map((s) => ({
          sheetId: s.properties?.sheetId ?? 0,
          title: s.properties?.title ?? "",
          rowCount: s.properties?.gridProperties?.rowCount ?? 0,
          columnCount: s.properties?.gridProperties?.columnCount ?? 0,
        })),
      };
    },
    async readTabs(spreadsheetId, tabTitles, opts) {
      const out: Record<string, unknown[][]> = {};
      if (!tabTitles.length) return out;
      const sheets = await client();
      const res = await sheets.spreadsheets.values.batchGet(
        {
          spreadsheetId,
          ranges: tabTitles.map(quoteTab),
          valueRenderOption: opts?.render ?? "UNFORMATTED_VALUE",
          dateTimeRenderOption: "SERIAL_NUMBER",
        },
        REQ_OPTS,
      );
      const ranges = res.data.valueRanges ?? [];
      tabTitles.forEach((t, i) => { out[t] = (ranges[i]?.values as unknown[][] | undefined) ?? []; });
      return out;
    },
    async writeCells(spreadsheetId, updates) {
      if (!updates.length) return;
      const sheets = await client();
      // API รับ valueInputOption ได้ค่าเดียวต่อครั้ง → แยก RAW กับ USER_ENTERED เป็น 2 คำสั่ง
      for (const mode of ["RAW", "USER_ENTERED"] as const) {
        const data = updates.filter((u) => u.mode === mode).map((u) => ({ range: u.range, values: u.values }));
        if (!data.length) continue;
        await sheets.spreadsheets.values.batchUpdate(
          { spreadsheetId, requestBody: { valueInputOption: mode, data } },
          REQ_OPTS,
        );
      }
    },
    async batchUpdate(spreadsheetId, requests) {
      if (!requests.length) return;
      const sheets = await client();
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, REQ_OPTS);
    },
  };
}
