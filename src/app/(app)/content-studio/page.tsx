import { Metadata } from "next";
import { Suspense } from "react";
import { ContentStudioClient } from "@/components/content-studio/ContentStudioClient";

export const metadata: Metadata = { title: "Content Studio" };

export default function ContentStudioPage() {
  return (
    <Suspense>
      <ContentStudioClient />
    </Suspense>
  );
}
