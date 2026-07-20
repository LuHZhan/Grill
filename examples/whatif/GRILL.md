# WhatIf

## 项目概述

一款小说转AI互动叙事游戏引擎，从中文小说中提取结构化世界数据（WorldPkg），然后驱动6个专用Agent协作生成互动叙事，支持Web UI、CLI和Electron桌面端。

## 架构

两阶段架构：Phase 1（Preprocessing）通过spaCy分句、LLM提取事件/Lorebook/实体状态转换，输出WorldPkg（zip）；Phase 2（Runtime）由GameEngine加载WorldPkg，AgentExecutor协调6个Agent（叙事生成、上下文丰富、记忆压缩、偏离引导、场景适配、平行时间线管理），通过FastAPI SSE流推送至前端/CLI/Electron。LLM调用通过LiteLLM抽象，支持多提供商，配置在llm_config.yaml中独立管理。

## 关键决策

1. 两阶段分离：提取与运行解耦，WorldPkg作为中间产物，支持离线提取后在线游玩。2. 6个Agent各司其职，通过注册表模式（类似C++工厂+虚函数表）在AgentExecutor中协同，避免单Agent瓶颈。3. LLM多提供商抽象：使用LiteLLM统一接口，每个Agent/Extractor独立配置模型参数，支持热更新（PUT /api/config/llm）。4. SSE流式推送：所有游戏交互通过Server-Sent Events实现，支持chunk（文本）、audio（TTS）、state、error、done事件类型。5. 记忆分层：MemoryCompressionAgent维护L0（短期）和L1（长期）摘要，控制token消耗。

## 值得注意

1. 依赖清单中无Redis/PostgreSQL，但自述提及，实际数据持久化仅靠文件系统（JSON/zip）。2. llm_config.yaml中extra_params不能覆盖保留键（model/messages/temperature/stream/response_format/max_tokens），否则报错。3. CLI读档通过启动菜单选择，不是/load命令。4. 日志位置logs/sessions/*.jsonl，可用tools/log_analyzer.html可视化分析。5. 前端SSE客户端封装在frontend/src/lib/api.ts，本地配置持久化用electron-store。

## 入口

- `backend/extract.py`
- `backend/play.py`
- `backend/api/app.py`
- `frontend/src/App.tsx`

## 目录树

### frontend

```
electron/
  main.ts
  preload.ts
  sidecar.ts
src/
  assets/
    fonts/
      PressStart2P-OFL.txt
  components/
    action-input.tsx
    background-layers.tsx
    command-bar.tsx
    loading-screen.tsx
    particle-canvas.tsx
    pixel-logo.tsx
    save-slots-modal.tsx
    story-viewport.tsx
    titlebar.tsx
  lib/
    api.ts
    audio-player.ts
    config-store.ts
    hooks.ts
    i18n.ts
    use-speech-recognition.ts
  locales/
    en.json
    zh-CN.json
  pages/
    gameplay-page.tsx
    library-page.tsx
    settings-page.tsx
    start-page.tsx
  styles/
  types/
    electron.d.ts
  App.tsx
  main.tsx
components.json
electron-builder.yml
eslint.config.mjs
index.html
package.json
pnpm-workspace.yaml
README.md
tsconfig.app.json
tsconfig.json
tsconfig.node.json
vite.config.ts
```

### backend

```
api/
  routes/
    __init__.py
    config.py
    extraction.py
    game.py
    logs.py
    voice.py
  __init__.py
  app.py
  deps.py
  schemas.py
  tts.py
core/
  prompts/
    json_output_system.txt
  __init__.py
  llm.py
  models.py
preprocessing/
  entity_transition/
    prompts/
      cross_validation.txt
      necessity_grading.txt
      repair.txt
      transition_annotation.txt
    __init__.py
    batch_manager.py
    cross_validator.py
    entity_scanner.py
    field_extractor.py
    necessity_grader.py
    repairer.py
    token_estimator.py
    transition_annotator.py
    validators.py
  lorebook/
    prompts/
      lorebook_extraction.txt
    __init__.py
    lorebook_extractor.py
  segmentation/
    prompts/
      decision_text_extraction.txt
      event_extraction.txt
    __init__.py
    decision_text_extractor.py
    event_extractor.py
    sentence_splitter.py
    text_cleaner.py
  __init__.py
  base.py
runtime/
  agents/
    context_enrichment/
      prompts/
        entity.txt
        l0_recall.txt
        l1_recall.txt
      __init__.py
      agent.py
      entity_recognizer.py
      formatters.py
      history_recall.py
      l0_recall.py
      l1_recall.py
    delta_lifecycle/
      __init__.py
      agent.py
    deviation_guidance/
      prompts/
        deviation_analysis.txt
      __init__.py
      agent.py
      deviation_controller.py
    memory_compression/
      prompts/
        l0_compress.txt
        l1_compress.txt
      __init__.py
      agent.py
      l0_compressor.py
      l1_compressor.py
    narrative_generation/
      orchestrator/
        prompts/
          confrontation_input.txt
          confrontation_system.txt
          orchestrator_shared.txt
          resolution_input.txt
          resolution_system.txt
          setup_bridge_sections.txt
          setup_input.txt
          setup_system.txt
        __init__.py
        loop.py
        phase_config.py
      writers/
        __init__.py
        prompt.txt
        writer.py
      __init__.py
      agent.py
      writer_bridge.py
    scene_adaptation/
      prompts/
        bridge_planner.txt
        scene_adapter.txt
      __init__.py
      agent.py
      bridge_planner.py
      scene_adapter.py
    __init__.py
    base.py
    delta_state.py
    models.py
  tools/
    __init__.py
    lorebook_query.py
  world/
    __init__.py
    loader.py
  __init__.py
  cli.py
  game_logger.py
  game.py
config.py
extract.py
llm_config.yaml
play.py
requirements.txt
server.py
whatif-server.spec
```
