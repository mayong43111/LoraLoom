/**
 * 视频库页面。
 *
 * 视频库统一管理下载得到或本地导入的视频，并把「视频抽帧」作为视频库内的
 * 一个工具：选中某个视频后，右侧展示其元信息与抽帧结果（若已抽帧）。
 * 抽帧不再是独立的导航菜单，而是隶属于视频库的一项操作。
 */

import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  List,
  Progress,
  Row,
  Space,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { EnumTag } from "@/components/EnumTag";
import {
  FRAME_COLOR,
  VIDEO_SOURCE_COLOR,
  VIDEO_STATUS_COLOR,
} from "@/colors";
import type { FrameJob, FrameResult, Video } from "@/api/types";

function formatSize(bytes: number): string {
  if (bytes <= 0) return "-";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function FrameTable({ job }: { job: FrameJob }) {
  const columns: ColumnsType<FrameResult> = [
    {
      title: "目标时间(s)",
      dataIndex: "target_timestamp",
      key: "target",
      render: (v: number) => v.toFixed(1),
    },
    {
      title: "实际时间(s)",
      dataIndex: "actual_timestamp",
      key: "actual",
      render: (v: number | null) => (v == null ? "-" : v.toFixed(2)),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: string) => (
        <EnumTag enumName="FrameStatus" value={v} colorMap={FRAME_COLOR} />
      ),
    },
    {
      title: "质量分",
      dataIndex: "quality_score",
      key: "quality",
      render: (v: number | null) => (v == null ? "-" : v.toFixed(2)),
    },
  ];
  return (
    <Table
      rowKey={(r) => `${job.id}-${r.target_timestamp}`}
      columns={columns}
      dataSource={job.frames}
      pagination={false}
      size="small"
    />
  );
}

function VideoDetail({
  video,
  job,
}: {
  video: Video;
  job: FrameJob | undefined;
}) {
  const extractable =
    video.status === "ready" || video.status === "queued";

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Descriptions
        column={2}
        size="small"
        bordered
        items={[
          {
            key: "source",
            label: "来源",
            children: (
              <EnumTag
                enumName="VideoSourceType"
                value={video.source_type}
                colorMap={VIDEO_SOURCE_COLOR}
              />
            ),
          },
          {
            key: "status",
            label: "状态",
            children: (
              <EnumTag
                enumName="VideoStatus"
                value={video.status}
                colorMap={VIDEO_STATUS_COLOR}
              />
            ),
          },
          {
            key: "resolution",
            label: "分辨率",
            children: `${video.width}×${video.height}`,
          },
          { key: "fps", label: "帧率", children: `${video.fps} fps` },
          {
            key: "duration",
            label: "时长",
            children: formatDuration(video.duration),
          },
          { key: "codec", label: "编码", children: video.codec },
          {
            key: "size",
            label: "大小",
            children: formatSize(video.size_bytes),
          },
          {
            key: "interval",
            label: "抽帧间隔",
            children: `${video.frame_interval}s`,
          },
          {
            key: "extracted",
            label: "已抽帧数",
            children: video.extracted_frame_count,
          },
          {
            key: "download",
            label: "关联下载",
            children: video.source_download_id ?? "-",
          },
        ]}
      />

      <Card
        size="small"
        title="抽帧工具"
        extra={
          <Space>
            <span style={{ fontSize: 12, color: "#8b90a0" }}>
              间隔 {video.frame_interval}s
            </span>
            <Button size="small" type="primary" disabled={!extractable}>
              {extractable ? "开始抽帧" : "已抽帧"}
            </Button>
          </Space>
        }
      >
        {job ? (
          <>
            <Progress
              percent={Math.round(job.progress * 100)}
              size="small"
              style={{ marginBottom: 12 }}
            />
            <FrameTable job={job} />
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="尚未抽帧，点击「开始抽帧」按间隔抽取并做邻近帧择优"
          />
        )}
      </Card>
    </Space>
  );
}

function VideoLibraryContent({
  videos,
  jobs,
}: {
  videos: Video[];
  jobs: FrameJob[];
}) {
  const [selectedId, setSelectedId] = useState(videos[0]?.id);
  const selected = videos.find((v) => v.id === selectedId) ?? videos[0];
  const jobByVideo = useMemo(() => {
    const map = new Map<string, FrameJob>();
    for (const job of jobs) map.set(job.video_id, job);
    return map;
  }, [jobs]);

  return (
    <Row gutter={16}>
      <Col xs={24} md={9} lg={8}>
        <Card title={`视频列表 · ${videos.length}`} size="small">
          <List
            dataSource={videos}
            renderItem={(video) => (
              <List.Item
                onClick={() => setSelectedId(video.id)}
                style={{
                  cursor: "pointer",
                  background:
                    video.id === selected?.id ? "#232733" : undefined,
                  borderRadius: 6,
                  padding: 12,
                }}
              >
                <List.Item.Meta
                  title={
                    <Space size={6}>
                      <span>{video.title}</span>
                      <EnumTag
                        enumName="VideoStatus"
                        value={video.status}
                        colorMap={VIDEO_STATUS_COLOR}
                      />
                    </Space>
                  }
                  description={
                    <Space size={8} style={{ fontSize: 12, color: "#8b90a0" }}>
                      <Tag
                        color={VIDEO_SOURCE_COLOR[video.source_type] ?? "default"}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {video.source_type === "download" ? "下载" : "本地"}
                      </Tag>
                      <span>{formatDuration(video.duration)}</span>
                      <span>·</span>
                      <span>{video.width}×{video.height}</span>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col xs={24} md={15} lg={16}>
        <Card
          title={selected ? `视频详情 · ${selected.title}` : "视频详情"}
          size="small"
        >
          {selected ? (
            <VideoDetail video={selected} job={jobByVideo.get(selected.id)} />
          ) : (
            <Empty description="暂无视频" />
          )}
        </Card>
      </Col>
    </Row>
  );
}

export function VideoLibraryPage() {
  const state = useAsync(
    () => Promise.all([api.listVideos(), api.listFrameJobs()]),
    [],
  );
  return (
    <>
      <PageHeader
        title="视频库"
        subtitle="管理下载与本地视频，抽帧作为视频库内的工具"
      />
      <AsyncBoundary state={state}>
        {([videos, jobs]) => (
          <VideoLibraryContent videos={videos} jobs={jobs} />
        )}
      </AsyncBoundary>
    </>
  );
}
