## 它做什么

没听懂一条消息时，输入 `wait-what`。[代理](https://www.aihero.dev/ai-coding-dictionary/agent)会重新解释刚才的内容，补足缺失背景，用清楚的中文表达，并使用项目 `GLOSSARY.md` 中的词汇。

Skill 只有三行，这是有意设计。针对啰嗦的 skills 经常因自身太长而失败。400 行的简洁 skill 仍会让[模型](https://www.aihero.dev/ai-coding-dictionary/model)啰嗦，因为模型模仿 skill 的长度，而非它的要求。这个 skill 只有一个准确的引导词。

## 何时使用

输入 `/wait-what` 调用。代理不会自行使用，也不应该，因为只有你知道自己何时开始跟不上。

发现自己开始略读时就用。例如，代理使用自创术语、在一句话中放五个缩写，或解释一个你没看过前提的决定。它修复当前对话。想从一开始避免术语问题，用 [grill-with-docs](https://aihero.dev/skills-grill-with-docs) 提前建立共享语言。

## 名称就是机制

引导词是 **wait**。“简洁一点”要求代理调整输出，模型会删减词语，让你更难理解。**Wait** 描述的是*你的*状态：从这里开始没听懂。听到“简短点”的代理会写短碎句；听到“等一下，我没跟上”的代理会回头解释。

这一区别就是整个 skill。流行的啰嗦修复都命名*输出*：`/tldr`、`/no-fluff`、`/talk-normal`。模型会过度纠正为更短却并不更清楚的碎句。命名*听众*状态，同时要求两件事：更少的词，**以及**你缺失的背景。

Skill 要求重新解释**那件事**，而非“最后一条消息”。让你听不懂的内容通常不只一个段落，所以由代理判断需要回溯多远。

## 复用现有语言

正文复用全局 `CLAUDE.md` 和项目 `GLOSSARY.md` 中已有的引导词。清楚易懂的中文决定表达方式，通用语言提供名词。Skill、`CLAUDE.md` 和 `GLOSSARY.md` 使用相同的 [tokens](https://www.aihero.dev/ai-coding-dictionary/token)，因此调用它是在提醒代理已经同意的要求。

没有 `GLOSSARY.md`，也没有 `GLOSSARY-MAP.md` 指向当前背景对应的术语表时，skill 仍然有效，只是缺少领域词汇这一部分。

## 有效运行的表现

- 重新解释**更短、更清楚**，而非更短、更生硬。
- 补足缺失前提，而非仅删词。
- 项目名词取代自创名词，`GLOSSARY.md` 中的术语重新出现。
- 连续用两次，也不会退化为过度简短的表达。

## 在流程中的位置

可以在任意对话、任意其他 skill 中随时使用 `wait-what`。它事后修复一条消息。根本做法是预先约定共享语言，[grill-with-docs](https://aihero.dev/skills-grill-with-docs) 就负责这件事：在[深入追问](https://www.aihero.dev/ai-coding-dictionary/grilling)过程中运行 [domain-modeling](https://aihero.dev/skills-domain-modeling)，把双方使用的词汇记录到 `GLOSSARY.md`。不确定哪个 skill 适合当前情形时，[ask-matt](https://aihero.dev/skills-ask-matt) 会帮你选择。
