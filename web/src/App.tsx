import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/layout/AppLayout";
import { ImportPage } from "@/pages/ImportPage";
import { DownloadsPage } from "@/pages/DownloadsPage";
import { VideoLibraryPage } from "@/pages/VideoLibraryPage";
import { ImagesPage } from "@/pages/ImagesPage";
import { QualityPage } from "@/pages/QualityPage";
import { PeoplePage } from "@/pages/PeoplePage";
import { ReviewPage } from "@/pages/ReviewPage";
import { SelectionPage } from "@/pages/SelectionPage";
import { ExportPage } from "@/pages/ExportPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ToolPage } from "@/tools/ToolPage";

export default function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/videos" replace />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/downloads" element={<DownloadsPage />} />
        <Route path="/videos" element={<VideoLibraryPage />} />
        <Route path="/images" element={<ImagesPage />} />
        <Route path="/quality" element={<QualityPage />} />
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/selection" element={<SelectionPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/tools/:id" element={<ToolPage />} />
      </Routes>
    </AppLayout>
  );
}
