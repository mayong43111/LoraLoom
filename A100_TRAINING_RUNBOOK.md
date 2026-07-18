# A100 LoRA 训练运行手册

本文记录 ImagesDataset 导出的 Qwen-Image LoRA 训练包在 Azure A100 VM 上的已验证运行方式。命令默认从 Windows PowerShell 执行。

新训练任务分配或更换触发词前，先查阅 `TRIGGER_WORD_REGISTRY.md`。该文件是触发词状态、分词证据和禁用原因的统一登记表。

## 固定资源与路径

| 项目 | 值 |
| --- | --- |
| Azure 资源组 | `RG-QWEN-LORA-JPE` |
| VM | `vm-qwen-lora-a100-jpe` |
| 区域 | `japaneast` |
| VM 型号 | `Standard_NC24ads_A100_v4` |
| SSH 用户 | `azureuser` |
| ai-toolkit | `/home/azureuser/ai-toolkit` |
| Python 环境 | `/anaconda/envs/aitk`（Python 3.11） |
| Hugging Face 缓存 | `/home/azureuser/hf_cache` |

不要使用系统 `/usr/bin/python`，它是 Python 2.7。训练必须使用 `/anaconda/envs/aitk/bin/python`，并显式设置 `HF_HOME=/home/azureuser/hf_cache`，否则可能重复下载约 54GB 的 Qwen 模型。

## 1. 启动 VM

```powershell
az account show -o table
az vm start -g RG-QWEN-LORA-JPE -n vm-qwen-lora-a100-jpe
```

确认电源状态并获取当前公网 IP。不要假设公网 IP 永远不变。

```powershell
$vm = az vm get-instance-view `
  -g RG-QWEN-LORA-JPE `
  -n vm-qwen-lora-a100-jpe `
  -o json | ConvertFrom-Json

($vm.instanceView.statuses |
  Where-Object code -like 'PowerState/*').displayStatus

$detail = az vm show -d `
  -g RG-QWEN-LORA-JPE `
  -n vm-qwen-lora-a100-jpe `
  -o json | ConvertFrom-Json

$ip = $detail.publicIps
$ip
Test-NetConnection $ip -Port 22
```

## 2. 训练前环境检查

```powershell
ssh azureuser@$ip '/anaconda/envs/aitk/bin/python --version'

ssh azureuser@$ip '/anaconda/envs/aitk/bin/python -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"'

ssh azureuser@$ip 'nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader; df -h /'

ssh azureuser@$ip 'pgrep -af "python.*run.py|accelerate|sd_trainer" || true'
```

预期 GPU 为 `NVIDIA A100 80GB PCIe`。开始新任务前必须确认没有其他训练进程。

验证 ai-toolkit 入口：

```powershell
ssh azureuser@$ip 'cd /home/azureuser/ai-toolkit && /anaconda/envs/aitk/bin/python run.py --help | head'
```

## 3. 清理旧训练输出

只删除明确不再需要的训练目录，不要清理 `/home/azureuser/hf_cache`。

```powershell
$runName = 'duo_jiang_qwen_lora_1024min'

ssh azureuser@$ip "du -sh /home/azureuser/ai-toolkit/output/$runName 2>/dev/null || true"
ssh azureuser@$ip "rm -rf /home/azureuser/ai-toolkit/output/$runName"
ssh azureuser@$ip "test ! -e /home/azureuser/ai-toolkit/output/$runName && echo REMOVED"
```

## 4. 上传训练包和配置

本地训练包和远端配置当前位于：

- `project_test_assets/第二次训练_qwen_image_lora_81img_1024min.zip`
- `project_test_assets/train_config.yaml`

```powershell
scp `
  project_test_assets\第二次训练_qwen_image_lora_81img_1024min.zip `
  project_test_assets\train_config.yaml `
  azureuser@${ip}:/home/azureuser/
```

上传后比较 SHA-256：

```powershell
$localHash = (Get-FileHash `
  'project_test_assets\第二次训练_qwen_image_lora_81img_1024min.zip' `
  -Algorithm SHA256).Hash.ToLower()

$remoteHash = ssh azureuser@$ip `
  'sha256sum /home/azureuser/*_1024min.zip | cut -d" " -f1'

$localHash -eq $remoteHash.Trim()
```

## 5. 部署独立数据目录

每次训练使用独立数据目录，避免混入旧图片。

```powershell
ssh azureuser@$ip @'
set -e
target=/home/azureuser/ai-toolkit/dataset/duo_jiang_1024min
rm -rf "$target"
mkdir -p "$target"
archive=$(find /home/azureuser -maxdepth 1 -name "*_1024min.zip" -print -quit)
unzip -q -j "$archive" "dataset/dataset/*" -d "$target"
cp /home/azureuser/train_config.yaml /home/azureuser/ai-toolkit/train_config_1024min.yaml
find "$target" -maxdepth 1 -type f | wc -l
'@
```

当前 81 张训练图应得到 162 个文件，即 81 张图片和 81 个同名 `.txt` caption。训练前还应确认：

- 图片与 caption stem 一一匹配。
- 所有图片都能被 Pillow 解码。
- 所有 caption 都以 `duo_jiang` 开头。
- 当前数据集最小短边为 1024。
- YAML 的数据目录与实际解包目录一致。

## 6. 启动后台训练

当前已审核参数：

| 参数 | 值 |
| --- | --- |
| 底模 | `Qwen/Qwen-Image-2512` |
| 触发词 | `duo_jiang` |
| 图片数 | 81 |
| LoRA rank / alpha | 32 / 32 |
| Steps | 2500 |
| 学习率 | `1e-4` |
| 分辨率桶 | 512 / 768 / 1024 |
| 保存与采样间隔 | 312 steps |
| 精度 | bf16 |

```powershell
$runName = 'duo_jiang_qwen_lora_1024min'

ssh azureuser@$ip @"
set -e
cd /home/azureuser/ai-toolkit
log=/home/azureuser/ai-toolkit/output/$runName.launch.log
rm -f \"`$log\" /home/azureuser/ai-toolkit/output/$runName.pid
nohup env `
  HF_HOME=/home/azureuser/hf_cache `
  PYTHONUNBUFFERED=1 `
  /anaconda/envs/aitk/bin/python run.py `
  /home/azureuser/ai-toolkit/train_config_1024min.yaml `
  -l /home/azureuser/ai-toolkit/output/$runName.train.log `
  > \"`$log\" 2>&1 < /dev/null &
pid=`$!
echo \"`$pid\" > /home/azureuser/ai-toolkit/output/$runName.pid
echo TRAIN_PID=`$pid
"@
```

## 7. 监控与故障判断

检查 PID、日志和 GPU：

```powershell
ssh azureuser@$ip "pid=`$(cat /home/azureuser/ai-toolkit/output/$runName.pid); kill -0 \"`$pid\" && ps -p \"`$pid\" -o pid,etime,state,%cpu,%mem,rss,cmd"

ssh azureuser@$ip "tail -100 /home/azureuser/ai-toolkit/output/$runName.launch.log"

ssh azureuser@$ip 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader; nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.free,temperature.gpu,power.draw --format=csv,noheader'
```

正常启动阶段依次包括：

1. `Loading Qwen Image model`
2. `Loading checkpoint shards: 100%`
3. `Quantizing Transformer`（60 blocks，可能需要数分钟）
4. 数据和 latent 缓存
5. 预训练 sample
6. 出现真实的 `n/2500` 训练进度和 loss

`Download complete: 0.00B` 表示模型权重命中本地缓存。仅看到 `Running 1 job` 或量化进度时，还不能认定已经进入训练 step。

查看 checkpoint 与样图：

```powershell
ssh azureuser@$ip "find /home/azureuser/ai-toolkit/output/$runName -maxdepth 2 -type f -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' | sort | tail -30"
```

增量拉取测试图使用仓库脚本，不要循环执行多个 `scp`：

```powershell
.\scripts\pull_training_samples.ps1
```

脚本会自动获取 VM 当前公网 IP，比较本地与远端文件名，仅在远端打包差集并单次下载。下载后会校验 ZIP 的 SHA-256、条目数量和 JPEG 文件头。没有新图时会直接返回；`ssh`/`scp` 远端命令均有进程级硬超时，不会无限等待。

停止当前训练：

```powershell
ssh azureuser@$ip "pid=`$(cat /home/azureuser/ai-toolkit/output/$runName.pid); kill \"`$pid\""
```

不要使用宽泛的 `pkill -f`，它可能匹配并终止当前 SSH 包装命令。

## 8. 下载产物并关闭 VM

训练完成后先下载 checkpoint 和样图，再关闭 VM。

```powershell
scp -r `
  azureuser@${ip}:/home/azureuser/ai-toolkit/output/duo_jiang_qwen_lora_1024min `
  project_test_assets\training_output\

az vm deallocate `
  -g RG-QWEN-LORA-JPE `
  -n vm-qwen-lora-a100-jpe
```

确认已释放计算资源：

```powershell
$vm = az vm get-instance-view `
  -g RG-QWEN-LORA-JPE `
  -n vm-qwen-lora-a100-jpe `
  -o json | ConvertFrom-Json

($vm.instanceView.statuses |
  Where-Object code -like 'PowerState/*').displayStatus
```

预期结果为 `VM deallocated`，而不只是 `VM stopped`。

## 本次运行记录（2026-07-17）

- VM 已启动并识别为 A100 80GB。
- 旧 `duo_jiang_qwen_lora` 输出已清理，释放约 2.8GB。
- 新训练包 SHA-256：`96ca0496f63c2a9f0bc892002175c173932ef6a5b26ceb9859baeea087eebf31`。
- 远端数据已验证为 81 张图片 + 81 个 caption，最小短边 1024。
- 训练 PID 文件：`/home/azureuser/ai-toolkit/output/duo_jiang_qwen_lora_1024min.pid`。
- 启动日志：`/home/azureuser/ai-toolkit/output/duo_jiang_qwen_lora_1024min.launch.log`。
- 训练日志：`/home/azureuser/ai-toolkit/output/duo_jiang_qwen_lora_1024min.train.log`。

## 第三轮固定形象训练（2026-07-17）

- 从第二轮 81 张中筛出 13 张固定属性一致图片：无眼镜、短波波头、黑色无袖连体装；脚部可见时均为赤足。
- Caption 仅保留动作、景别和背景，不描述性别、发型、服装/鞋袜或饰品。
- 远端数据目录：`/home/azureuser/ai-toolkit/dataset/duo_jiang_round3_13img`。
- 训练名称：`duo_jiang_qwen_lora_round3_13img`。
- 参数：rank 32、1200 steps、学习率 `5e-5`、1024 单桶、caption dropout 0。
- 最终训练包 SHA-256：`bb2020092f49d00a606bb3dd67f37ed78382f6ad6e44859699ee95012e23ee8d`。
- 每 200 steps 保存并采样；seed 固定为 42，`walk_seed: false`。
- 第二轮仅保留 1872 checkpoint，归档目录：`/home/azureuser/ai-toolkit/output/duo_jiang_round2_1872`。
- 第二轮 1872 SHA-256：`12d63f3b445f37af7bd50008fc799c123b7894927f7287c71e81862d1f3118f3`。
- 第三轮 PID 文件：`/home/azureuser/ai-toolkit/output/duo_jiang_qwen_lora_round3_13img.pid`。
- 第三轮启动日志：`/home/azureuser/ai-toolkit/output/duo_jiang_qwen_lora_round3_13img.launch.log`。
- 增量样图默认保存到本地 `project_test_assets/training_output/round3_samples`。
- 第三轮在 step 1000 人工中止：纯触发词不生成人物，健身房提示仍生成双人且穿鞋袜，仅近景脸部开始收敛。
- 第三轮 step 1000 SHA-256：`91ad42710af9be77a783509af26f5963a0e50c6fbb415ec31dc65b8542cf8d00`。

## 第四轮戴眼镜固定形象训练（2026-07-17）

- SQLite 数据集：`第四次训练`（`ds-b89321d87082`）。
- 共 31 张：固定戴眼镜、短波波头、黑色无袖连体装。
- 31 条 Caption 均不描述固定人物属性。
- 2 张黑袜偏差图明确标注 `wearing black socks`。
- 19 张字幕/文字覆盖图明确标注 `Chinese text overlay`。
- 图片解码、Caption、触发词和重复文件检查均已通过。
- 本地训练包：`project_test_assets/第四次训练_qwen_image_lora_31img_1024_ready.zip`。
- 训练包 SHA-256：`b8b54a4c2bd6f84fc7b793f342a8f67236ba42e6755ae210410ddb7f0a6b1e46`。
- 远端数据目录：`/home/azureuser/ai-toolkit/dataset/duo_jiang_round4_31img`。
- 训练名称：`duo_jiang_qwen_lora_round4_31img`。
- 参数：rank 32、1800 steps、学习率 `5e-5`、1024 单桶、caption dropout 0。
- 每 200 steps 保存并采样；seed 固定为 42，`walk_seed: false`。
- 启动 PID：`119155`。
- PID 文件：`/home/azureuser/ai-toolkit/output/duo_jiang_qwen_lora_round4_31img.pid`。
- 启动日志：`/home/azureuser/ai-toolkit/output/duo_jiang_qwen_lora_round4_31img.launch.log`。
- 增量样图默认保存到本地 `project_test_assets/training_output/round4_samples`。
- 第四轮在 step 853 中止，并保留 step 800 checkpoint：纯触发词从 baseline 起即带有江景先验，训练至 600 后退化为纯江景。
- 第四轮 step 800 SHA-256：`137ae5eb4108d67babc43a2b144c00a61a16aae821ddead123c329730f1a7cde`。

## 第五轮低语义触发词训练（2026-07-17）

- 触发词改为 `zxqv`。Qwen-Image tokenizer 将其拆为两个罕见 token：`zx` + `qv`。
- 不使用 `哆酱`，因为它有中文昵称语义；不使用 `DJ260717`，因为 `DJ` 是完整既有 token，且日期被拆为六个数字 token。
- 31 条 Caption 仅替换首个触发词，动作、景别、背景及偏差属性描述保持不变。
- 本地训练包：`project_test_assets/第五次训练_zxqv_qwen_image_lora_31img_1024_ready.zip`。
- 训练包 SHA-256：`14c83dafba197c65a95ec55b0c79a58abc5ed25e1b52e48571b14332dabcefa3`。
- 远端数据目录：`/home/azureuser/ai-toolkit/dataset/zxqv_round5_31img`。
- 训练名称：`zxqv_qwen_lora_round5_31img`。
- 参数保持可比：rank 32、学习率 `5e-5`、1024 单桶、caption dropout 0。初始上限 1800 steps，固定 seed 样图显示 1200 才开始绑定人物，因此上限扩展到 3200。
- 每 200 steps 保存并采样；seed 固定为 42，`walk_seed: false`。
- 1800 后继续按 200-step 样图评估；重点比较 2000、2400、2800、3200，若身份已固定但姿态/背景明显坍缩则提前停止。
- 启动 PID：`145240`。
- PID 文件：`/home/azureuser/ai-toolkit/output/zxqv_qwen_lora_round5_31img.pid`。
- 启动日志：`/home/azureuser/ai-toolkit/output/zxqv_qwen_lora_round5_31img.launch.log`。
- 增量样图默认保存到本地 `project_test_assets/training_output/round5_samples`。
- 2026-07-18 将训练上限从 3200 扩展到 4000；从无编号最终权重 `zxqv_qwen_lora_round5_31img.safetensors` 恢复，元数据确认 step 3200，并同时加载 `optimizer.pt`。
- 3200→4000 续训日志：`/home/azureuser/ai-toolkit/train_round5_3200_to_4000.log`。已验证训练实际推进到 step 3276，学习率保持 `5e-5`。
- 4000 训练完成后，最终权重元数据确认 `step: 4000`、`epoch: 127`，并已生成 step 4000 的 3 张固定 seed 样图。
- 2026-07-18 将训练上限继续扩展到 6000；run name、数据集、rank、学习率和采样参数均保持不变，配置仍为 `/home/azureuser/ai-toolkit/train_config_round5.yaml`。
- 4000→6000 续训 PID：`45663`；日志：`/home/azureuser/ai-toolkit/train_round5_4000_to_6000.log`。日志已确认识别 step 4000、加载 `optimizer.pt`，并实际推进到 step 4002。
- 6000 训练完成后，最终权重元数据确认 `step: 6000`、`epoch: 191`，optimizer 和 step 6000 的 3 张固定 seed 样图均已保存。
- 2026-07-18 将训练上限继续扩展到 8000；6000→8000 续训 PID：`114499`，日志：`/home/azureuser/ai-toolkit/train_round5_6000_to_8000.log`。
- 6000→8000 日志已确认识别 step 6000、加载 `optimizer.pt`，并实际推进到 step 6001；学习率保持 `5e-5`。
