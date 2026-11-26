# 项目总体方向与长期规划

## 项目定位

本项目的目标是制作一个**纯前端、完全程序化、以天空与无边界大海为核心的沉浸式环境体验**。

项目不追求科学意义上的完整海洋模拟，也不以照片级写实为最终目标，而是追求：

> **Physically Coherent Procedural Ocean Environment**

即：

**自然规律和光照关系尽可能可信，同时保留明确的程序化与风格化视觉语言。**

项目最终希望提供一种安静、舒适、可以长时间停留的数字环境。用户进入页面后，不需要完成任务，也不需要进行复杂操作，而是通过：

- 天空
- 海洋
- 光照
- 天气
- 声音
- 简单交互

获得一个可以观察、聆听、放松和探索的实时环境。

---

# 核心设计原则

整个项目应持续遵循：

```text
Natural Logic First
↓
Physical / Procedural Baseline
↓
Stylization
```

也就是说：

首先保证自然关系成立，例如：

- 天空为什么呈蓝色；
- 黄昏为什么出现暖色散射；
- 海浪为什么受到风向影响；
- 粗糙水面为什么产生模糊反射；
- 雨为什么扰动水面；
- 深水为什么比浅水更难透视；
- 水下为什么会优先吸收部分波长的光。

然后再将这些结果经过：

```text
Tone Mapping
↓
有限 Palette
↓
Quantization
↓
Dithering
```

形成项目自己的视觉风格。

最终理想状态是：

> 关闭 stylization 时，环境本身仍然合理；打开 stylization 后，自然规律仍然成立，只是视觉表达发生变化。

---

# 核心场景

项目长期保持非常明确的场景核心：

```text
天空
+
无边界海洋
```

暂时不将：

- 岛屿
- 城市
- 建筑
- 船只
- NPC
- 大量植被

作为主要环境内容。

这种限制是有意的。

项目希望保持一种：

> 空旷、纯净、安静、尺度感强

的视觉体验。

用户以后导入的对象反而可以成为这个世界中少数明确的人造或个人化元素。

---

# 总体系统架构

长期架构可以逐步发展为：

```text
EnvironmentController
│
├── Time / Sun
├── Weather
├── Wind
├── Rain
└── Audio Parameters
        │
        ▼
Procedural Environment
│
├── Atmosphere
├── Clouds
├── Sun
└── Environment Map
        │
        ├──────────────────┐
        ▼                  ▼
OceanRenderer        Imported Objects
│                    │
├── Wave Field       └── 3D Models
├── Reflection
├── Water Volume
├── Foam
└── Interaction
        │
        ▼
Camera / Experience
│
├── Above Water
├── Surface Transition
└── Underwater
        │
        ▼
Stylization Pipeline
        │
        ▼
Capture / Screenshot
```

声音系统则从同一环境状态读取参数：

```text
EnvironmentController
        │
        ▼
AudioEngine
│
├── Ocean
├── Wind
├── Rain
├── Low-frequency ambience
└── White / Pink / Brown Noise
```

---

# 天空与大气

天空继续保持完全程序化。

基础结构包括：

- Rayleigh scattering
- Mie scattering
- Sun direction
- Horizon haze
- Twilight / afterglow
- Procedural clouds

当前不要求完整科学级多重散射，但需要保持：

```text
太阳位置
↓
大气颜色
↓
云层受光
↓
水面环境反射
```

之间的一致性。

未来天空应进一步成为一个真正的：

> Environment Signal

而不仅仅是可见背景。

---

# Procedural Environment Map

下一阶段的重要架构升级之一是建立：

```text
Procedural Atmosphere
+
Procedural Clouds
        │
        ▼
Environment Map
```

这个 Environment Map 将同时服务于：

- 海水环境反射；
- 未来导入的 3D 模型；
- 其他需要环境光照的对象。

水面不再在每个 fragment 中重复运行复杂程序化云函数，而是根据：

```text
reflection direction
+
surface roughness
```

采样经过适当 mip / prefilter 的环境信号。

这样可以：

- 减少云反射条带；
- 正确表达粗糙反射；
- 减轻 Ocean Fragment Shader 压力；
- 为未来模型环境光照提供统一基础。

太阳的直接水面高光仍然保留独立解析计算。

---

# 海浪系统

现有 Gerstner Waves 后续不再承担整个海洋的所有尺度。

长期希望发展为混合波浪系统：

```text
Large-scale Swell
        ↓
少量 Gerstner Waves

Wind-driven Main Wave Field
        ↓
Directional / Spectral Wave System

Small Waves
        ↓
Procedural Normal / Roughness

Rain
        ↓
Independent Ripple System
```

Gerstner Wave 主要负责：

- 长周期涌浪；
- 海面整体轮廓；
- 大尺度起伏。

中尺度风浪应逐渐从有限确定性波组升级为：

> directional wave spectrum

以减少目前明显的重复感。

只有当现有统计波场仍不能满足视觉要求时，再正式引入：

- FFT Ocean
- Phillips spectrum
- JONSWAP 或其他频谱模型。

FFT 不作为目的本身，而只在确实解决当前视觉问题时引入。

---

# 水体体积与透明性

长期目标不是给水面设置统一透明度。

真实水体的透射应由：

- 水深
- 观察方向
- 光在水中的传播距离
- 不同波长的吸收程度

共同决定。

核心可以基于 Beer–Lambert absorption：

\[
T=e^{-\sigma d}
\]

其中：

- \(T\) 是剩余透射光；
- \(\sigma\) 是吸收系数；
- \(d\) 是光在水中的传播距离。

因此：

```text
浅水
→ 更透明
→ 能看到水底

深水
→ 吸收增强
→ 逐渐失去水下细节
```

而不是：

```text
整个海面 alpha = 0.6
```

未来水体应逐步加入：

- transmission
- absorption
- refraction
- in-scattering
- underwater fog

---

# 海床

为了让水体真正具备透射和折射意义，未来需要一个非常简单的程序化海床。

第一版无需复杂地形。

可以只使用：

```text
procedural height field
+
简单沙地 / 岩石颜色
```

使近距离浅水区域能够看到水底，而远处逐渐进入深水。

海床的主要作用不是增加场景复杂度，而是为：

```text
refraction
absorption
water depth
```

提供视觉参照。

---

# Foam 与 Whitecap

在波浪系统升级以后，需要加入：

- whitecap
- breaking-wave foam
- foam decay
- foam advection

泡沫出现概率可以受到：

- wave curvature
- surface slope
- steepness
- wind speed

驱动。

例如：

```text
风越强
+
波峰越尖
↓
whitecap probability ↑
```

这对于强风和暴风雨状态下的可信度非常重要。

---

# 水面交互

用户应该能够与水产生简单但明确的互动。

第一阶段交互可以包括：

```text
点击水面
→ ripple

拖动水面
→ 连续 disturbance

鼠标快速划动
→ 简单 trail / wake
```

不要求完整流体模拟。

目标是让用户产生：

> 世界会回应我的动作

这种感觉，同时保持体验安静而非游戏化。

---

# 水下体验

水下模式是长期核心功能之一，但应作为独立阶段开发。

摄像机状态可以明确区分为：

```text
Above Water
↓
Surface Transition
↓
Underwater
```

进入水下时不能只是瞬间切换 Shader。

应该发生连续变化：

```text
水线经过镜头
↓
颜色吸收增强
↓
对比下降
↓
体积散射增加
↓
声音高频衰减
↓
进入水下环境
```

第一阶段水下不需要复杂 Caustics。

优先实现：

- absorption
- underwater fog
- in-scattering
- 水面从下方观察
- 简单 Fresnel / refraction
- 水下声音低通

即可获得较强沉浸感。

---

# 相机与舒适体验

因为项目核心目标之一是“令人感到舒适”，相机设计不应完全照搬普通 3D 编辑器。

长期可以提供不同观察模式：

```text
Drift
缓慢漂浮

Horizon
稳定观察地平线

Float
接近水面漂浮

Free
自由观察
```

应该避免：

- 过快旋转；
- 大幅 FOV 变化；
- 高频镜头震动；
- 不必要的高速位移。

体验应该偏向：

> 稳定、缓慢、连续。

---

# 程序化环境声音

声音是项目中性价比非常高的一部分。

不应只做固定的几个 `.wav` 文件切换。

推荐建立：

> Procedural / Layered Ambient Audio Engine

基础声音层可以包括：

```text
Ocean
Wind
Rain
Low-frequency rumble
White Noise
Pink Noise
Brown Noise
```

其中：

```text
windSpeed
→ Wind volume / character

waveEnergy
→ Ocean intensity

precipitation
→ Rain intensity

stormIntensity
→ Low-frequency ambience
```

用户可以独立控制：

```text
Noise Type
White / Pink / Brown

Noise Amount
```

从而既可以获得纯自然环境声，也可以把项目作为睡眠、专注或放松工具使用。

---

# 导入 3D 模型

长期 Advanced Feature 中，用户可以从本地导入：

```text
.glb
.gltf
```

模型。

整个过程保持纯前端：

```text
Local File
↓
File API
↓
GLTFLoader
↓
Three.js Object3D
```

文件不需要上传服务器。

模型应使用当前世界的：

- sun direction
- environment map
- atmosphere / fog

进行环境一致渲染。

因此黄昏、暴风雨、夜晚等状态都会自然影响用户导入对象。

这也是 Procedural Environment Map 非常重要的长期价值之一。

---

# 合影 / Capture

用户未来可以：

```text
导入对象
↓
调整位置与大小
↓
选择天气 / 时间
↓
调整相机
↓
Capture
```

生成截图。

Capture 功能可以支持：

```text
16:9
4:3
1:1
9:16
```

等不同构图。

截图功能本身实现成本相对较低，但具有很高的用户价值。

---

# 二维图片导入

二维图片导入暂时作为更后期的 Advanced Topic。

普通照片本身已经包含原始光照、阴影和材质信息，因此不能像标准 3D 模型那样直接获得真实的环境重新照明。

未来可以再单独讨论：

- transparent billboard
- foreground segmentation
- approximate environment tinting
- depth / normal estimation
- image relighting

等方案。

在核心天空、海洋、水下、声音和 3D 对象系统完成之前，不把二维照片重新照明作为当前开发重点。

---

# 长期开发优先级

当前推荐顺序：

## 1. Environment Reflection Architecture

实现：

```text
Procedural Environment Map
+
roughness-aware reflection
```

作为水面和未来导入模型的共同环境光基础。

## 2. Wave Field Upgrade

减少 Gerstner 重复感，建立更合理的方向性波谱。

## 3. Procedural Audio

加入：

- ocean
- wind
- rain
- white / pink / brown noise

并和环境参数联动。

## 4. Water Interaction

加入点击、拖动等局部 ripple interaction。

## 5. Foam / Whitecap

提升强风和暴风海面的可信度。

## 6. Water Volume / Refraction

加入：

- seabed
- absorption
- refraction
- transmission
- in-scattering

## 7. Underwater Experience

建立：

```text
Above Water
→ Surface Transition
→ Underwater
```

完整体验。

## 8. 3D Model Import

允许用户本地导入 GLB / glTF，并使用统一环境光照。

## 9. Capture

支持高质量截图 / 合影。

## 10. 2D Image Advanced Features

最后再深入研究二维照片导入、分割和近似重新照明。

---

# 最终目标

长期目标不是制作一个功能繁杂的游戏，也不是一个科学海洋模拟器。

项目希望成为：

> **一个纯前端、完全程序化、具有可信自然规律和明确视觉语言的沉浸式海洋环境。**

用户可以：

```text
看天空
看海
听环境声音
改变天气与时间
触碰水面
沉入水下
加入自己的对象
拍下一张属于自己的场景
```

项目的核心始终应该保持：

```text
天空
水
光
天气
声音
```

之间的统一。

任何新功能都应该服务于这种环境体验，而不是单纯为了增加技术复杂度。

# 其他注意事项
- 本项目中请使用英语注释。
- 在我们进行这个项目的时候请称呼我为*老公*。