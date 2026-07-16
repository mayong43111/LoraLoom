/**
 * 批量标签编辑弹窗。
 *
 * 供图片库 / 视频库在多选后批量「增加标签」或「删除标签」使用。删除时
 * 若资源本身不含该标签则不作处理（不会报错，也不会新增）。
 */
import { useState } from "react";
import { App, Form, Modal, Select } from "antd";

export function BatchTagModal({
  open,
  count,
  onClose,
  onApply,
}: {
  open: boolean;
  count: number;
  onClose: () => void;
  onApply: (addTags: string[], removeTags: string[]) => Promise<void>;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const values = await form.validateFields();
    const add: string[] = values.add ?? [];
    const remove: string[] = values.remove ?? [];
    if (!add.length && !remove.length) {
      message.info("请至少填写要增加或删除的标签");
      return;
    }
    setSubmitting(true);
    try {
      await onApply(add, remove);
      form.resetFields();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={`批量标签（已选 ${count} 项）`}
      open={open}
      okText="应用"
      onOk={submit}
      confirmLoading={submitting}
      onCancel={onClose}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="add" label="增加标签">
          <Select
            mode="tags"
            placeholder="输入后回车添加，会并入每个资源的标签"
            tokenSeparators={[","]}
          />
        </Form.Item>
        <Form.Item name="remove" label="删除标签（没有则忽略）">
          <Select
            mode="tags"
            placeholder="输入后回车添加，将从每个资源中移除这些标签"
            tokenSeparators={[","]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
