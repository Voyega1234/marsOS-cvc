import { Metadata } from "next"
import SEOIntelligenceLabClient from "./SEOIntelligenceLabClient"

export const metadata: Metadata = { title: "SEO Intelligence Lab" }

export default function SEOIntelligenceLabPage() {
  return <SEOIntelligenceLabClient />
}
