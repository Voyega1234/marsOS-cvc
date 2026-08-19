#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  ตั้งค่า ADC (Application Default Credentials) สำหรับ local dev
#
#  ใช้แทน OIDC เฉพาะบนเครื่อง — โค้ดใน src/lib/google-auth.ts และ
#  src/lib/vertex.ts จะสลับไปใช้ ADC อัตโนมัติเมื่อไม่ได้รันบน Vercel
#
#  รันครั้งเดียว (ต้อง login ผ่าน browser):
#    ./scripts/gcloud-adc.sh
#  หรือระบุ service account เอง:
#    ./scripts/gcloud-adc.sh my-sa@my-project.iam.gserviceaccount.com
# ─────────────────────────────────────────────────────────────
set -e

# gcloud SDK ติดตั้งไว้ที่ ~/google-cloud-sdk (ต้องใช้ Python >= 3.10)
export CLOUDSDK_PYTHON="${CLOUDSDK_PYTHON:-$HOME/.local/bin/python3.11}"
GCLOUD="$HOME/google-cloud-sdk/bin/gcloud"

# ค่าเริ่มต้น: ใช้สิทธิ์ user ตรงๆ (bob@convertcake.com มีสิทธิ์ Vertex อยู่แล้ว)
# ถ้าจะ impersonate service account ให้ส่ง SA มาเป็น argument:
#   ./scripts/gcloud-adc.sh my-sa@my-project.iam.gserviceaccount.com
# (ต้องมี role "Service Account Token Creator" บน SA นั้นก่อน)
SA="${1:-}"

"$GCLOUD" config set project ai-seo-keyword-research

# login เฉพาะถ้ายังไม่ได้ login (จะได้ไม่ต้องเปิด browser ซ้ำ)
if ! "$GCLOUD" auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q "bob@convertcake.com"; then
  "$GCLOUD" auth login bob@convertcake.com --brief
fi
# หมายเหตุ: การขอ scope GSC/GA4 เพิ่ม (--scopes) โดนองค์กร Google Workspace บล็อก
# ("This app is blocked") จึงใช้ scope มาตรฐาน (cloud-platform) พอสำหรับ Vertex/Gemini
# ส่วน GSC/GA4 ทดสอบบน production ผ่าน OIDC ตามเดิม

if [ -n "$SA" ]; then
  "$GCLOUD" auth application-default login --impersonate-service-account="$SA"
  echo ""
  echo "✅ ADC พร้อมใช้ (impersonate: $SA)"
else
  "$GCLOUD" --quiet auth application-default login
  echo ""
  echo "✅ ADC พร้อมใช้ (สิทธิ์ user: bob@convertcake.com)"
fi
echo "   restart dev server แล้วระบบจะใช้ ADC แทน OIDC อัตโนมัติ"
