import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Segmented,
  Space,
  Typography,
} from "antd";
import { api } from "@/api/client";
import { useAsync } from "@/api/useAsync";
import { useLabels } from "@/api/labels";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { PageHeader } from "@/components/PageHeader";
import { Thumbnail } from "@/components/Thumbnail";
import type { ImageModel } from "@/api/types";

function ReviewWorkbench({ initial }: { initial: ImageModel[] }) {
  const { message } = App.useApp();
  const { entries, label } = useLabels();
  const [queue] = useState(initial);
  const [index, setIndex] = useState(0);
  const [orientation, setOrientation] = useState<string>();
  const [usability, setUsability] = useState<string>();
  const [saving, setSaving] = useState(false);

  const current = queue[index];

  useEffect(() => {
    if (current) {
      setOrientation(current.orientation);
      setUsability(current.usability);
    }
  }, [current]);

  const orientationOptions = useMemo(
    () =>
      entries("Orientation").map((e) => ({ label: e.label, value: e.value })),
    [entries],
  );
  const usabilityOptions = useMemo(
    () => entries("Usability").map((e) => ({ label: e.label, value: e.value })),
    [entries],
  );

  if (!current) {
    return <Empty description="队列已清空，全部复核完成" />;
  }

  const submit = async () => {
    setSaving(true);
    try {
      await api.updateAnnotation(current.id, { orientation, usability });
      message.success(`已保存 ${current.id}`);
      setIndex((i) => i + 1);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const progress = Math.round((index / queue.length) * 100);

  return (
    <Row gutter={16}>
      <Col xs={24} md={14}>
        <Card size="small">
          <Space direction="vertical" align="center" style={{ width: "100%" }}>
            <Thumbnail
              seed={current.thumbnail_hint || current.id}
              size={360}
              ratio={current.width / current.height}
            />
            <Typography.Text type="secondary">
              {current.id} · {current.width}×{current.height} · Q
              {current.quality_score.toFixed(2)}
            </Typography.Text>
          </Space>
        </Card>
      </Col>
      <Col xs={24} md={10}>
        <Card size="small" title={`复核进度 ${index}/${queue.length}`}>
          <Progress percent={progress} style={{ marginBottom: 20 }} />

          <Typography.Text strong>朝向</Typography.Text>
          <div style={{ margin: "8px 0 20px" }}>
            <Segmented
              options={orientationOptions}
              value={orientation}
              onChange={(v) => setOrientation(v as string)}
            />
          </div>

          <Typography.Text strong>可用性</Typography.Text>
          <div style={{ margin: "8px 0 24px" }}>
            <Segmented
              options={usabilityOptions}
              value={usability}
              onChange={(v) => setUsability(v as string)}
            />
          </div>

          <Space>
            <Button
              type="primary"
              loading={saving}
              onClick={submit}
            >
              保存并下一张
            </Button>
            <Button
              disabled={index >= queue.length - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              跳过
            </Button>
          </Space>

          <div style={{ marginTop: 16, color: "#8b90a0", fontSize: 12 }}>
            当前自动判定：朝向 {label("Orientation", current.orientation)} ·
            可用性 {label("Usability", current.usability)}
          </div>
        </Card>
      </Col>
    </Row>
  );
}

export function ReviewPage() {
  const state = useAsync(() => api.listReviewQueue(true), []);
  return (
    <>
      <PageHeader title="复核" subtitle="人工确认朝向与可用性" />
      <AsyncBoundary state={state}>
        {(queue) =>
          queue.length === 0 ? (
            <Empty description="没有待复核的图片" />
          ) : (
            <ReviewWorkbench initial={queue} />
          )
        }
      </AsyncBoundary>
    </>
  );
}
