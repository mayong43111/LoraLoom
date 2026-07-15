import { Routes, Route } from "react-router-dom";
import { AppLayout } from "@/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { ImportPage } from "@/pages/ImportPage";
import { BrowserPage } from "@/pages/BrowserPage";
import { DownloadsPage } from "@/pages/DownloadsPage";
import { ImagesPage } from "@/pages/ImagesPage";
import { FramesPage } from "@/pages/FramesPage";
import { QualityPage } from "@/pages/QualityPage";
import { PeoplePage } from "@/pages/PeoplePage";
import { ReviewPage } from "@/pages/ReviewPage";
import { SelectionPage } from "@/pages/SelectionPage";
import { ExportPage } from "@/pages/ExportPage";
import { SettingsPage } from "@/pages/SettingsPage";

export default function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/browser" element={<BrowserPage />} />
        <Route path="/downloads" element={<DownloadsPage />} />
        <Route path="/images" element={<ImagesPage />} />
        <Route path="/frames" element={<FramesPage />} />
        <Route path="/quality" element={<QualityPage />} />
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/selection" element={<SelectionPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppLayout>
  );
}
