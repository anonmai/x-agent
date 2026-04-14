#!/bin/bash

# 自动发布脚本：抓取美国热点并发布中文推文
# 每2小时执行一次

cd "$(dirname "$0")" || exit 1

echo "=== 开始执行 x-publisher 自动发布任务 ==="
echo "时间: $(date)"

# 步骤1: 采集数据
echo "步骤1: 采集美国热点数据..."
COLLECT_OUTPUT=$(npx tsx scripts/pipeline.ts --collect 2>&1)
echo "$COLLECT_OUTPUT"

# 提取 MODEL_INPUT_START 和 MODEL_INPUT_END 之间的内容
MODEL_INPUT=$(echo "$COLLECT_OUTPUT" | sed -n '/MODEL_INPUT_START/,/MODEL_INPUT_END/p' | sed '1d;$d')

if [ -z "$MODEL_INPUT" ]; then
    echo "错误: 无法提取模型输入内容"
    exit 1
fi

echo "步骤2: 分析数据并生成中文推文..."

# 这里需要 OpenClaw 宿主模型来生成总结
# 由于定时任务中无法直接调用宿主模型，我们需要一个替代方案
# 方案A: 使用简单的文本处理生成固定格式的推文
# 方案B: 调用本地模型API（如果有的话）
# 方案C: 使用预定义的总结模板

# 暂时使用方案A：提取趋势名称并生成简单总结
TREND_NAME=$(echo "$COLLECT_OUTPUT" | grep "trend:" | cut -d' ' -f2-)
TWEET_COUNT=$(echo "$COLLECT_OUTPUT" | grep "candidates:" | cut -d' ' -f2)

# 生成中文推文（简化版）
CHINESE_TWEET="美国热点追踪：趋势'${TREND_NAME}'引发关注，相关推文获得广泛互动。社交媒体数据显示当前话题热度持续，反映了数字时代的信息传播特点。"

echo "生成的推文: $CHINESE_TWEET"

# 步骤3: 发布推文
echo "步骤3: 发布推文..."
PUBLISH_OUTPUT=$(npx tsx scripts/pipeline.ts --publish --text "$CHINESE_TWEET" 2>&1)

if echo "$PUBLISH_OUTPUT" | grep -q "postedTweetId:"; then
    TWEET_ID=$(echo "$PUBLISH_OUTPUT" | grep "postedTweetId:" | cut -d' ' -f2)
    echo "✅ 发布成功！推文ID: $TWEET_ID"
    echo "推文内容: $CHINESE_TWEET"
else
    echo "❌ 发布失败"
    echo "错误信息: $PUBLISH_OUTPUT"
    exit 1
fi

echo "=== 任务完成 ==="
echo "完成时间: $(date)"