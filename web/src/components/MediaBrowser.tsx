/**
 * 媒体浏览器：在当前目录（分组/根目录）内以大图 / 视频形式逐个浏览，
 * 支持上一个 / 下一个切换，以及对当前项执行「移动到分组」「删除」操作。
 *
 * 图片与视频通用：调用方通过 `onMove` / `onDelete` 注入对应的库 API，
 * 组件内部维护浏览序列，删除或移出当前目录后自动从序列中剔除并前进。
 */
import { useEffect, useState } from "react";
import { App, Button, Modal, Select, Space, Tooltip, Typography } from "antd";
import {
  DeleteOutlined,
  LeftOutlined,
  RightOutlined,
  SwapOutlined,
} from "@ant-design/icons";

export interface MediaBrowserItem {
  id: string;
  title: string;
  kind: "image" | "video";
}

export interface MediaBrowserGroup {
  id: string;
  name: string;
}

const ROOT_VALUE = "__root__";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max));
}

export function MediaBrowser({
  open,
  items,
  startIndex,
  groups,
  ungroupedName,
  onClose,
  onMove,
  onDelete,
  onChanged,
}: {
  open: boolean;
  /** 当前目录内的媒体项（仅文件，不含子分组）。 */
  items: MediaBrowserItem[];
  /** 起始浏览下标。 */
  startIndex: number;
  /** 可移动到的分组列表。 */
  groups: MediaBrowserGroup[];
  /** 「未分组」占位名（会从可选分组中排除）。 */
  ungroupedName?: string;
  onClose: () => void;
  onMove: (id: string, groupId: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** 发生移动/删除等数据变更后回调，请求宿主刷新列表。 */
  onChanged: () => void;
}) {
  const { modal, message } = App.useApp();
  const [list, setList] = useState<MediaBrowserItem[]>(items);
  const [index, setIndex] = useState(startIndex);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string>(ROOT_VALUE);
  const [busy, setBusy] = useState(false);

  // 仅在弹窗打开的瞬间根据传入项重置浏览序列与下标，避免宿主刷新时跳位。
  useEffect(() => {
    if (open) {
      setList(items);
      setIndex(clamp(startIndex, 0, Math.max(0, items.length - 1)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const current = list[index] ?? null;

  const go = (delta: number) => {
    setIndex((i) => clamp(i + delta, 0, list.length - 1));
  };

  // 键盘左右方向键切换。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (moveOpen) return;
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, moveOpen, list.length]);

  // 从浏览序列中剔除当前项，并把下标夹到有效范围；序列空则关闭。
  const removeCurrent = () => {
    setList((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        onClose();
        return next;
      }
      setIndex((i) => clamp(i, 0, next.length - 1));
      return next;
    });
  };

  const doDelete = () => {
    if (!current) return;
    modal.confirm({
      title: "删除确认",
      content: `确定删除「${current.title || current.id}」吗？此操作不可撤销。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setBusy(true);
        try {
          await onDelete(current.id);
          message.success("已删除");
          removeCurrent();
          onChanged();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "删除失败");
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const doMove = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await onMove(current.id, moveTarget === ROOT_VALUE ? null : moveTarget);
      message.success("已移动");
      setMoveOpen(false);
      removeCurrent();
      onChanged();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "移动失败");
    } finally {
      setBusy(false);
    }
  };

  const previewNode = () => {
    if (!current) return null;
    if (current.kind === "image") {
      return (
        <img
          src={`/api/images/${encodeURIComponent(current.id)}/raw`}
          alt={current.title}
          style={{
            maxWidth: "100%",
            maxHeight: "70vh",
            objectFit: "contain",
            borderRadius: 6,
            background: "#0f1116",
          }}
        />
      );
    }
    return (
      <video
        key={current.id}
        src={`/api/videos/${encodeURIComponent(current.id)}/stream`}
        controls
        style={{
          maxWidth: "100%",
          maxHeight: "70vh",
          borderRadius: 6,
          background: "#0f1116",
        }}
      />
    );
  };

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        width={960}
        centered
        destroyOnClose
        title={
          current
            ? `浏览 · ${current.title || current.id}（${index + 1}/${list.length}）`
            : "浏览"
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Tooltip title="上一个（←）">
            <Button
              shape="circle"
              icon={<LeftOutlined />}
              disabled={index <= 0}
              onClick={() => go(-1)}
            />
          </Tooltip>
          <div
            style={{
              flex: 1,
              minHeight: 320,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#0f1116",
              borderRadius: 8,
              padding: 8,
            }}
          >
            {current ? previewNode() : <Typography.Text type="secondary">暂无可浏览项</Typography.Text>}
          </div>
          <Tooltip title="下一个（→）">
            <Button
              shape="circle"
              icon={<RightOutlined />}
              disabled={index >= list.length - 1}
              onClick={() => go(1)}
            />
          </Tooltip>
        </div>

        <div
          style={{
            marginTop: 16,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <Space>
            <Button
              icon={<SwapOutlined />}
              disabled={!current || busy}
              onClick={() => {
                setMoveTarget(ROOT_VALUE);
                setMoveOpen(true);
              }}
            >
              移动到分组
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={!current || busy}
              onClick={doDelete}
            >
              删除
            </Button>
          </Space>
        </div>
      </Modal>

      <Modal
        title="移动到分组"
        open={moveOpen}
        okText="移动"
        confirmLoading={busy}
        onOk={doMove}
        onCancel={() => setMoveOpen(false)}
        destroyOnClose
      >
        <Select
          style={{ width: "100%" }}
          value={moveTarget}
          onChange={setMoveTarget}
          options={[
            { value: ROOT_VALUE, label: "根目录（未分组）" },
            ...groups
              .filter((g) => g.name !== ungroupedName)
              .map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
      </Modal>
    </>
  );
}
