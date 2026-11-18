import type { Granularity, RangeKey } from "@/lib/playlistAnalyticsRange";

/** Shape of GET /api/playlists/:id/analytics (aggregated numbers only). */
export interface AnalyticsPoint {
  date: string;
  label: string;
  views: number;
  downloads: number;
}

export interface AnalyticsResponse {
  playlist: { id: number; title: string };
  range: { key: RangeKey; from: string; to: string; days: number; granularity: Granularity; timezone: string; today: string };
  views: { total: number; unique: number };
  downloads: { total: number };
  earnings: { available: boolean; currency: string | null; message: string };
  series: AnalyticsPoint[];
  insights: {
    avgDailyViews: number;
    avgDailyDownloads: number;
    bestDay: { date: string; label: string; views: number; downloads: number } | null;
    topFiles: { title: string; fileType: string | null; downloads: number }[];
  };
}

export interface RangeSelection {
  key: RangeKey;
  from?: string;
  to?: string;
}
