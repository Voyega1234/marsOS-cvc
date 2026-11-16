/** ชีทจำลองในหน่วยความจำ สำหรับเทสโควต้า (ไม่ใช่โค้ดที่ใช้จริง — ห้าม import prisma / googleapis) */
import type { ReadTabsOptions, SheetsPort, SheetTabInfo } from "./quota-sheets-port";

/** formulas = ตารางคู่ขนานกับ grid เก็บข้อความสูตรของเซลล์ที่เป็นสูตร (grid เก็บผลลัพธ์ของสูตร) */
export interface FakeTab { sheetId: number; title: string; rowCount: number; columnCount: number; grid: unknown[][]; formulas: unknown[][] }

export class FakeSheetsPort implements SheetsPort {
  title = "ชีททดสอบ";
  tabs: FakeTab[] = [];
  /** คำสั่งโครงสร้างที่ไม่ได้จำลอง (mergeCells / copyPaste ...) */
  other: object[] = [];
  /** ทุกคำสั่งเขียนค่า เรียงตามเวลา */
  writes: { range: string; values: (string | number)[][]; mode: string }[] = [];
  /** ตั้ง error ให้ทุกคำสั่งเขียน */
  failWrites: unknown = null;
  /** ตั้งให้ batchUpdate ล้ม (ทดสอบ best-effort) */
  failBatch: unknown = null;
  /** ตั้งให้ readTabs ล้ม */
  failReads: unknown = null;
  /** จำนวนครั้งที่ readTabs ถูกเรียก */
  reads = 0;
  /** เรียกก่อนเขียนค่าทุกครั้ง (เทสจังหวะแข่งกัน / ล้มเฉพาะบางครั้ง) */
  beforeWrite: (() => void | Promise<void>) | null = null;

  addTab(title: string, grid: unknown[][] = [], rowCount = Math.max(grid.length, 10), columnCount = 26): FakeTab {
    const t: FakeTab = { sheetId: 100 + this.tabs.length, title, rowCount, columnCount, grid: grid.map((r) => [...r]), formulas: [] };
    this.tabs.push(t);
    return t;
  }
  tab(title: string): FakeTab {
    const t = this.tabs.find((x) => x.title === title);
    if (!t) throw new Error(`no tab ${title}`);
    return t;
  }
  cell(title: string, row1: number, col0: number): unknown {
    return this.tab(title).grid[row1 - 1]?.[col0];
  }

  /** ตั้งเซลล์ให้เป็นสูตร: formula = ข้อความสูตร, value = ผลลัพธ์ที่ชีทแสดง */
  setFormula(title: string, row1: number, col0: number, formula: string, value: unknown = ""): void {
    const t = this.tab(title);
    while (t.grid.length < row1) t.grid.push([]);
    while (t.formulas.length < row1) t.formulas.push([]);
    t.grid[row1 - 1][col0] = value;
    t.formulas[row1 - 1][col0] = formula;
  }
  formula(title: string, row1: number, col0: number): unknown {
    return this.tab(title).formulas[row1 - 1]?.[col0];
  }

  async getSpreadsheet(): Promise<{ title: string; tabs: SheetTabInfo[] }> {
    return { title: this.title, tabs: this.tabs.map((t) => ({ sheetId: t.sheetId, title: t.title, rowCount: t.rowCount, columnCount: t.columnCount })) };
  }

  async readTabs(_id: string, titles: string[], opts?: ReadTabsOptions): Promise<Record<string, unknown[][]>> {
    this.reads++;
    if (this.failReads) throw this.failReads;
    const out: Record<string, unknown[][]> = {};
    for (const title of titles) {
      const t = this.tab(title);
      const rows = t.grid.map((r, i) => {
        const c = [...r];
        if (opts?.render === "FORMULA") {
          (t.formulas[i] ?? []).forEach((f, j) => {
            if (f === undefined || f === null || f === "") return;
            while (c.length < j) c.push("");
            c[j] = f;
          });
        }
        while (c.length && (c[c.length - 1] === undefined || c[c.length - 1] === "" || c[c.length - 1] === null)) c.pop();
        return c;
      });
      while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
      out[title] = rows;
    }
    return out;
  }

  async writeCells(_id: string, updates: { range: string; values: (string | number)[][]; mode: "RAW" | "USER_ENTERED" }[]): Promise<void> {
    if (this.beforeWrite) await this.beforeWrite();
    if (this.failWrites) throw this.failWrites;
    for (const u of updates) {
      this.writes.push({ range: u.range, values: u.values, mode: u.mode });
      const m = /^(?:'((?:[^']|'')*)'|([^!]+))!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(u.range);
      if (!m) throw new Error(`bad range ${u.range}`);
      const title = (m[1] ?? m[2]).replace(/''/g, "'");
      const t = this.tab(title);
      const c0 = colIndex(m[3]);
      const r0 = Number(m[4]) - 1;
      u.values.forEach((vals, i) => {
        while (t.grid.length <= r0 + i) t.grid.push([]);
        if (r0 + i >= t.rowCount) throw new Error(`write beyond grid: ${u.range}`);
        vals.forEach((v, j) => {
          t.grid[r0 + i][c0 + j] = v;
          if (t.formulas[r0 + i]) t.formulas[r0 + i][c0 + j] = undefined; // เขียนค่าทับ = สูตรหาย
        });
      });
    }
  }

  async batchUpdate(_id: string, requests: object[]): Promise<void> {
    if (this.failBatch) throw this.failBatch;
    if (this.failWrites) throw this.failWrites;
    for (const r of requests as Record<string, any>[]) {
      if (r.appendDimension) {
        const t = this.tabById(r.appendDimension.sheetId);
        if (r.appendDimension.dimension === "ROWS") t.rowCount += r.appendDimension.length;
        else t.columnCount += r.appendDimension.length;
      } else if (r.insertDimension) {
        const { sheetId, startIndex, endIndex } = r.insertDimension.range;
        const t = this.tabById(sheetId);
        const n = endIndex - startIndex;
        while (t.grid.length < startIndex) t.grid.push([]);
        t.grid.splice(startIndex, 0, ...Array.from({ length: n }, () => [] as unknown[]));
        if (t.formulas.length > startIndex) t.formulas.splice(startIndex, 0, ...Array.from({ length: n }, () => [] as unknown[]));
        t.rowCount += n;
      } else {
        this.other.push(r);
      }
    }
  }

  private tabById(id: number): FakeTab {
    const t = this.tabs.find((x) => x.sheetId === id);
    if (!t) throw new Error(`no sheetId ${id}`);
    return t;
  }
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** แถวตัวอย่างหัวตารางมาตรฐาน */
export const FAKE_HEADER = ["Type", "Website", "Price / Link", "Unit", "Start", "EXP.", "Link URL", "Published Date", "Clients", "Status", "REMARK"];
