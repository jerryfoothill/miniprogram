// 事件类型定义
interface EventMessage {
    id: string;           // 事件唯一标识符
    type: string;         // 事件类型，如 'message', 'assessment', 'task_complete'
    role: string;         // 角色，'self' 或 'opponent' 或 'system'
    content: string;      // 内容
    options?: string[];   // 选项，用于assessment事件
    correctAnswer?: string; // 正确答案，用于assessment事件
    explanation?: string;   // 解释，用于assessment事件
    transitions?: EventTransition[]; // 过渡条件，用于有向图跳转
    nextId?: string;      // 简单跳转的下一个事件ID (用于没有条件的转换)
    delay?: number;       // 可选的延迟时间（毫秒），控制事件显示间隔
    setFlags?: Record<string, any>; // 用于设置自定义标志
    highlightTarget?: string; // 高亮目标元素
}

// 过渡条件定义
interface EventTransition {
    targetId: string;     // 目标事件ID
    conditions: EventCondition[]; // 跳转条件列表
}

// 事件条件
interface EventCondition {
    type: 'messageCount' | 'flag' | 'lastEvent' | 'correctAnswerCount' | 'wrongAnswerCount' | 'correctAnswer' | 'custom'; // 条件类型
    value?: any; // 条件值
    key?: string; // 用于flag类型条件的键名
    param?: string; // 额外参数
    operator?: string; // 运算符: '==', '!=', '>', '<', '>=', '<='
}

// 事件订阅定义
interface EventSubscription {
    eventId: string;
    callback: () => void;
    once: boolean;
}

// 格式化后的消息类型（适配chat-container组件）
interface FormattedMessage {
    _id: string;          // 消息ID，格式为 msg-{index}
    type: string;         // 消息类型，如 'text'
    content: string;      // 内容
    role: string;         // 角色，'user' 或 'assistant'
    timestamp: number;    // 时间戳
}

// 元数据定义
interface Metadata {
    title: string;        // 对话标题
    description: string;  // 描述
    opponent: {
        nickname: string; // 对方昵称
        avatarUrl: string;// 对方头像
    };
    createdAt: string;    // 创建时间
    updatedAt: string;    // 更新时间
    tags: string[];       // 标签
    startId?: string;     // 开始事件ID（用于有向图的起点）
}

// 事件数据定义
interface EventData {
    metadata: Metadata;
    events: EventMessage[];
}

// 条件状态
interface ConditionState {
    messageCount: number;           // 用户消息计数
    correctAnswerCount: number;     // 正确回答计数
    wrongAnswerCount: number;       // 错误回答计数
    lastEventId: string;            // 最后一个事件ID
    customFlags: Record<string, any>; // 自定义标志
    userAnswers: Record<string, any>; // 用户回答记录
}

Component({
    /**
     * 组件的属性列表
     */
    properties: {
        // 数据ID，用于从数据工具中加载对应的对话数据
        dataSource: {
            type: String,
            value: '',
            observer: function (newVal) {
                if (newVal) {
                    this.loadData(newVal);
                }
            }
        },
        // 事件播放速度，单位为毫秒乘数（1表示原速，2表示加速2倍）
        playbackSpeed: {
            type: Number,
            value: 1
        },
        // 是否自动开始播放
        autoPlay: {
            type: Boolean,
            value: true
        },
        // 是否允许用户输入
        interactionMode: {
            type: Boolean,
            value: true  // 修改为默认允许用户输入
        }
    },

    /**
     * 组件的初始数据
     */
    data: {
        // 元数据
        metadata: {
            title: '',
            description: '',
            opponent: {
                nickname: '对方',
                avatarUrl: '/assets/icons/default-avatar.svg'
            },
            createdAt: '',
            updatedAt: '',
            tags: [] as string[],
            startId: undefined
        } as Metadata,
        // 原始事件数据
        allEvents: [] as EventMessage[],
        // 事件索引查询表
        eventMap: {} as Record<string, EventMessage>,
        // 已显示的消息
        messages: [] as EventMessage[],
        // 格式化后的消息，用于chat-container
        formattedMessages: [] as FormattedMessage[],
        // 当前事件ID
        currentEventId: '',
        // 是否正在播放
        isPlaying: false,
        // 是否完成播放
        isComplete: false,
        // 输入文本
        inputText: '',
        // 是否允许输入
        allowInput: true,  // 修改为默认允许用户输入
        // 滚动视图ID
        scrollToView: 'message-bottom',
        // 开始时间文本
        startTimeText: '今天 12:00',
        // 评估对话框
        showAssessment: false,
        // 当前评估事件
        currentAssessment: null as EventMessage | null,
        // 用户选择的答案
        userAnswer: '',
        // 是否已显示结果
        showAssessmentResult: false,
        // 条件状态
        conditionState: {
            messageCount: 0,
            correctAnswerCount: 0,
            wrongAnswerCount: 0,
            lastEventId: '',
            customFlags: {},
            userAnswers: {}
        } as ConditionState,
        // 默认延迟时间（毫秒）
        defaultDelay: 1000,
        // 进行中的定时器ID
        activeTimers: [] as number[],
        // 播放开始时间戳
        playbackStartTime: 0,
        // 事件订阅映射
        _eventSubscriptions: {} as Record<string, EventSubscription[]>,
        // UI高亮相关
        showHighlight: false,       // 是否显示高亮
        highlightTarget: '',        // 要高亮的目标元素
        highlightRectPosition: {}   // 高亮区域的位置信息
    },

    /**
     * 组件的方法列表
     */
    methods: {
        // 订阅事件
        subscribeToEvent(eventId: string, callback: () => void, once = false) {
            // 确保订阅映射已初始化
            const subscriptions = this.data._eventSubscriptions || {};
            if (!subscriptions[eventId]) {
                subscriptions[eventId] = [];
            }
            subscriptions[eventId].push({ eventId, callback, once });
            this.setData({ _eventSubscriptions: subscriptions });
        },

        // 取消订阅事件
        unsubscribeFromEvent(eventId: string, callback?: () => void) {
            const subscriptions = this.data._eventSubscriptions;
            if (!subscriptions || !subscriptions[eventId]) return;

            if (callback) {
                // 移除特定回调的订阅
                subscriptions[eventId] = subscriptions[eventId].filter(
                    (subscription: EventSubscription) => subscription.callback !== callback
                );
            } else {
                // 移除所有该事件的订阅
                subscriptions[eventId] = [];
            }

            this.setData({ _eventSubscriptions: subscriptions });
        },

        // 触发事件
        triggerEventById(eventId: string) {
            const subscriptions = this.data._eventSubscriptions[eventId];
            if (!subscriptions || subscriptions.length === 0) return;

            // 执行回调并移除once类型的订阅
            const remainingSubscriptions = [];

            for (const subscription of subscriptions) {
                try {
                    subscription.callback();
                } catch (e) {
                    console.error(`Error executing subscription for event ${eventId}:`, e);
                }

                if (!subscription.once) {
                    remainingSubscriptions.push(subscription);
                }
            }

            // 更新订阅列表
            const updatedSubscriptions = { ...this.data._eventSubscriptions };
            updatedSubscriptions[eventId] = remainingSubscriptions;
            this.setData({ _eventSubscriptions: updatedSubscriptions });
        },

        // 清除所有事件订阅
        clearAllSubscriptions() {
            console.log('清除所有事件订阅');
            this.setData({ _eventSubscriptions: {} });
        },

        // 加载数据
        loadData(source: string) {
            // 显示加载中提示
            wx.showLoading({
                title: '加载中...',
            });

            try {
                // 从数据工具加载
                const dataUtils = require('../../data/data_utils');
                const data = dataUtils.getDataModule(source);

                if (data) {
                    this.processData(data);
                } else {
                    wx.showToast({
                        title: '未找到数据',
                        icon: 'none'
                    });
                }
            } catch (e) {
                console.error('Failed to load data:', e);
                wx.showToast({
                    title: '加载失败',
                    icon: 'none'
                });
            } finally {
                wx.hideLoading();
            }
        },

        // 处理数据
        processData(data: any) {
            if (!data || !Array.isArray(data.events)) {
                console.error('无效的事件数据');
                return false;
            }

            console.log('处理事件数据:', data);

            // 清除所有现有订阅和定时器
            this.clearAllSubscriptions();
            this.clearAllTimers();

            // 提取元数据
            const metadata = data.metadata || {};
            const startId = (metadata && metadata.startId) || (data.events[0] && data.events[0].id);
            const defaultDelay = metadata.defaultDelay || 1000;

            // 构建事件映射
            const eventMap: Record<string, EventMessage> = {};
            const allEvents: EventMessage[] = [];

            // 处理事件
            for (const event of data.events) {
                if (!event.id) {
                    console.warn('跳过没有ID的事件:', event);
                    continue;
                }

                // 确保每个事件都有type属性
                if (!event.type) {
                    event.type = 'message';
                }

                // 确保消息事件有role属性
                if (event.type === 'message' && !event.role) {
                    event.role = 'system';
                }

                // 存储事件
                eventMap[event.id] = event;
                allEvents.push(event);
            }

            console.log(`处理了 ${allEvents.length} 个事件，起始事件: ${startId}`);

            // 更新组件状态
            this.setData({
                metadata,
                startId,
                defaultDelay,
                eventMap,
                allEvents,
                isComplete: false,
                isPlaying: false,
                playbackStartTime: Date.now(),
                allowInput: true // 启用输入功能
            });

            // 准备完成，延迟一点启动播放以确保UI更新
            setTimeout(() => {
                this.startPlayback();
            }, 100);

            return true;
        },

        // 格式化消息，将原始消息格式转换为chat-container所需的格式
        formatMessages(messages: EventMessage[]): FormattedMessage[] {
            return messages.map((msg, index) => ({
                _id: `msg-${index}`,
                type: 'text', // 默认为文本类型
                content: msg.content,
                role: msg.role === 'self' ? 'user' : 'assistant', // 将self转为user，将opponent转为assistant
                timestamp: Date.now() - (messages.length - index) * 1000 // 简单生成时间戳，较新的消息时间较晚
            }));
        },

        // 格式化时间显示
        formatTimeText(date: Date): string {
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            return `今天 ${hours}:${minutes}`;
        },

        // 清除所有计时器
        clearAllTimers() {
            console.log(`清除所有计时器: ${this.data.activeTimers.length}个`);

            // 清除所有活动的计时器
            this.data.activeTimers.forEach(timerId => {
                clearTimeout(timerId);
            });

            // 重置计时器列表
            this.setData({ activeTimers: [] });
        },

        // 开始播放
        startPlayback() {
            // 取消所有活动的计时器
            this.clearAllTimers();

            console.log('开始播放对话，清空状态');

            // 获取起始事件ID
            const { metadata, allEvents } = this.data;
            const startId = (metadata && metadata.startId) || (allEvents[0] && allEvents[0].id);
            console.log(`起始事件ID: ${startId}`);

            // 重置条件状态
            const resetConditionState: ConditionState = {
                messageCount: 0,
                lastEventId: '',
                customFlags: {},
                correctAnswerCount: 0,
                wrongAnswerCount: 0,
                userAnswers: {}
            };

            // 记录开始时间
            const playbackStartTime = Date.now();

            // 重置视图状态
            this.setData({
                messages: [],
                formattedMessages: [],
                conditionState: resetConditionState,
                isPlaying: true,
                showAssessment: false,
                currentAssessment: null,
                playbackStartTime,
                allowInput: true // 启用输入功能
            });

            // 如果有有效的起始事件，开始处理
            if (startId && this.data.eventMap[startId]) {
                console.log(`找到起始事件: ${startId}`);
                // 设置当前事件并处理
                this.setData({ currentEventId: startId });
                this.processEvent(startId);
            } else {
                console.error('起始事件未找到:', startId);
                wx.showToast({
                    title: '未找到起始事件',
                    icon: 'error'
                });
            }
        },

        // 检查条件是否满足
        checkCondition(condition: EventCondition): boolean {
            const conditionState = this.data.conditionState;

            console.log(`检查条件: ${condition.type}`, condition, conditionState);

            switch (condition.type) {
                case 'messageCount':
                    return conditionState.messageCount >= (condition.value || 0);

                case 'flag':
                    if (condition.key && condition.value !== undefined) {
                        const flagValue = conditionState.customFlags[condition.key];
                        console.log(`检查标志 ${condition.key}: ${flagValue} === ${condition.value}`);
                        return flagValue === condition.value;
                    }
                    return false;

                case 'lastEvent':
                    return conditionState.lastEventId === condition.value;

                default:
                    console.warn('未知条件类型:', condition.type);
                    return false;
            }
        },

        // 获取下一个事件ID
        getNextEventId(event: EventMessage): string | null {
            if (!event.transitions || event.transitions.length === 0) {
                console.log(`事件 ${event.id} 没有指定转换`);
                return null;
            }

            // 遍历所有转换
            for (const transition of event.transitions) {
                // 无条件转换
                if (!transition.conditions || transition.conditions.length === 0) {
                    console.log(`事件 ${event.id} 使用无条件转换到 ${transition.targetId}`);
                    return transition.targetId;
                }

                // 条件转换：所有条件都必须满足
                const allConditionsMet = transition.conditions.every(condition =>
                    this.checkCondition(condition)
                );

                if (allConditionsMet) {
                    console.log(`事件 ${event.id} 所有条件满足，转换到 ${transition.targetId}`);
                    return transition.targetId;
                }
            }

            console.log(`事件 ${event.id} 没有满足条件的转换`);
            return null;
        },

        // 处理指定ID的事件
        processEvent(eventId: string) {
            if (!eventId || !this.data.eventMap[eventId]) {
                console.error(`事件ID不存在: ${eventId}`);
                return;
            }

            const event = this.data.eventMap[eventId];
            console.log(`处理事件: ${eventId}`, event);

            // 更新当前事件ID
            this.setData({ currentEventId: eventId });

            // 根据事件类型处理
            switch (event.type) {
                case 'message':
                    this.handleMessageEvent(event);
                    break;

                case 'system':
                    this.handleSystemEvent(event);
                    break;

                case 'assessment':
                    this.handleAssessmentEvent(event);
                    break;

                case 'waiting_for_input':
                    this.handleWaitingForInputEvent(event);
                    break;

                case 'ui_highlight':
                    this.handleUIHighlightEvent(event);
                    break;

                default:
                    console.warn(`未知事件类型: ${event.type}`);
                    // 未知类型的事件也尝试转到下一个
                    this.transitionToNextEvent(event);
            }
        },

        // 处理系统事件
        handleSystemEvent(event: EventMessage) {
            console.log(`处理系统事件: ${event.id}`);

            // 更新条件状态
            const conditionState = { ...this.data.conditionState };
            conditionState.lastEventId = event.id;

            // 设置自定义标志
            if (event.setFlags && typeof event.setFlags === 'object') {
                console.log(`设置自定义标志:`, event.setFlags);
                for (const [key, value] of Object.entries(event.setFlags)) {
                    conditionState.customFlags[key] = value;
                }
            }

            // 更新状态
            this.setData({ conditionState });

            // 系统事件通常不显示，直接转到下一个事件
            const delay = event.delay || 0;
            if (delay > 0) {
                console.log(`系统事件延迟 ${delay}ms 后转到下一步`);
                const adjustedDelay = delay / this.properties.playbackSpeed;
                const timerId = setTimeout(() => {
                    this.transitionToNextEvent(event);
                }, adjustedDelay);

                // 添加到活动计时器列表
                this.setData({
                    activeTimers: [...this.data.activeTimers, timerId]
                });
            } else {
                // 立即转到下一个事件
                this.transitionToNextEvent(event);
            }
        },

        // 处理消息类型事件
        handleMessageEvent(event: EventMessage) {
            console.log(`处理消息事件: ${event.id}`);

            // 忽略系统消息的显示，除非强制显示
            if (event.role === 'system' && event.type !== 'system_display') {
                console.log(`跳过系统消息显示: ${event.id}`);
                this.transitionToNextEvent(event);
                return;
            }

            // 添加消息到列表
            const messages = [...this.data.messages, event];
            const formattedMessages = this.formatMessages(messages);

            // 更新视图
            this.setData({
                messages,
                formattedMessages,
                scrollToView: `msg-${messages.length - 1}`
            });

            // 更新条件状态
            const conditionState = { ...this.data.conditionState };
            conditionState.lastEventId = event.id;
            this.setData({ conditionState });

            // 检查是否需要用户交互
            if (event.transitions && event.transitions.some(t =>
                t.conditions && t.conditions.some(c => c.type === 'messageCount' && c.value > 0))) {
                console.log(`事件 ${event.id} 等待用户交互`);
                // 确保用户可以输入消息
                this.setData({ allowInput: true });
                // 无需设置定时器，用户消息会触发下一步
                return;
            }

            // 延迟转到下一个事件
            const delay = event.delay || this.data.defaultDelay;
            const adjustedDelay = delay / this.properties.playbackSpeed;

            console.log(`事件 ${event.id} 将在 ${adjustedDelay}ms 后转到下一步`);

            const timerId = setTimeout(() => {
                // 从活动定时器列表中移除
                const activeTimers = [...this.data.activeTimers];
                const timerIndex = activeTimers.indexOf(timerId);
                if (timerIndex !== -1) {
                    activeTimers.splice(timerIndex, 1);
                    this.setData({ activeTimers });
                }

                this.transitionToNextEvent(event);
            }, adjustedDelay);

            // 添加到活动定时器列表
            this.setData({
                activeTimers: [...this.data.activeTimers, timerId]
            });
        },

        // 处理评估类型事件
        handleAssessmentEvent(event: EventMessage) {
            console.log(`处理评估事件: ${event.id}`);

            // 更新条件状态
            const conditionState = { ...this.data.conditionState };
            conditionState.lastEventId = event.id;

            // 显示评估对话框
            this.setData({
                currentAssessment: event,
                showAssessment: true,
                conditionState
            });

            // 评估事件通常等待用户交互，无需自动转到下一个事件
        },

        // 处理任务完成类型事件
        handleTaskCompleteEvent(event: EventMessage) {
            // 显示提示
            wx.showToast({
                title: event.content || '任务完成！',
                icon: 'success',
                duration: 2000
            });

            // 延迟转到下一个事件
            const delay = event.delay || 2000;
            const adjustedDelay = delay / this.properties.playbackSpeed;

            const timerId = setTimeout(() => {
                // 从活动定时器列表中移除
                const activeTimers = [...this.data.activeTimers];
                const timerIndex = activeTimers.indexOf(timerId);
                if (timerIndex !== -1) {
                    activeTimers.splice(timerIndex, 1);
                    this.setData({ activeTimers });
                }

                this.transitionToNextEvent(event);
            }, adjustedDelay);

            // 添加到活动定时器列表
            this.setData({
                activeTimers: [...this.data.activeTimers, timerId]
            });
        },

        // 评估条件是否满足
        evaluateCondition(condition: EventCondition): boolean {
            const { type, param, value, operator = '==' } = condition;
            const { conditionState } = this.data;

            let leftValue;

            // 获取条件左侧值
            switch (type) {
                case 'messageCount':
                    leftValue = conditionState.messageCount;
                    break;
                case 'correctAnswerCount':
                    leftValue = conditionState.correctAnswerCount;
                    break;
                case 'wrongAnswerCount':
                    leftValue = conditionState.wrongAnswerCount;
                    break;
                case 'correctAnswer':
                    const eventId = param || conditionState.lastEventId;
                    leftValue = eventId ? conditionState.userAnswers[eventId] === (this.data.eventMap[eventId] && this.data.eventMap[eventId].correctAnswer) : false;
                    break;
                case 'flag':
                    if (condition.key) {
                        leftValue = conditionState.customFlags[condition.key];
                        console.log(`评估标志 ${condition.key}:`, leftValue, '与', value);
                    }
                    break;
                case 'custom':
                    leftValue = param ? conditionState.customFlags[param] : undefined;
                    break;
                default:
                    console.warn('未知条件类型:', type);
                    return false;
            }

            // 评估条件
            switch (operator) {
                case '==':
                    return leftValue == value;
                case '!=':
                    return leftValue != value;
                case '>':
                    return leftValue > value;
                case '<':
                    return leftValue < value;
                case '>=':
                    return leftValue >= value;
                case '<=':
                    return leftValue <= value;
                default:
                    return leftValue === value; // 默认使用严格相等
            }
        },

        // 根据条件转到下一个事件
        transitionToNextEvent(event: EventMessage) {
            // 获取下一个事件ID
            const nextEventId = this.getNextEventId(event);

            if (nextEventId) {
                console.log(`事件 ${event.id} 转向 ${nextEventId}`);
                // 处理下一个事件
                this.processEvent(nextEventId);
            } else {
                console.log(`事件 ${event.id} 无下一步，结束流程`);
                // 没有下一个事件，结束播放
                this.completePlayback();
            }
        },

        // 完成播放
        completePlayback() {
            console.log('完成对话播放');

            // 清除所有计时器
            this.clearAllTimers();

            // 更新状态
            this.setData({
                isComplete: true,
                isPlaying: false,
                allowInput: true // 完成后也允许输入，以便用户可以继续交互
            });

            // 触发完成事件
            this.triggerEvent('playComplete', {
                messageCount: this.data.messages.length,
                userMessageCount: this.data.conditionState.messageCount,
                duration: Date.now() - this.data.playbackStartTime
            });
        },

        // 暂停播放
        pausePlayback() {
            if (!this.data.isPlaying) return;

            // 清除所有定时器
            this.clearAllTimers();

            this.setData({
                isPlaying: false
            });

            this.triggerEvent('playPause');
        },

        // 切换播放状态
        onTogglePlay() {
            if (this.data.isPlaying) {
                this.pausePlayback();
            } else {
                this.resumePlayback();
            }
        },

        // 恢复播放
        resumePlayback() {
            if (this.data.isPlaying) return;

            this.setData({
                isPlaying: true
            });

            // 如果有当前事件，继续处理
            if (this.data.currentEventId) {
                this.processEvent(this.data.currentEventId);
            } else {
                // 否则从头开始
                this.startPlayback();
            }
        },

        // 重新开始事件序列
        onRestart() {
            wx.showLoading({
                title: '重新开始...',
            });

            try {
                // 清除所有定时器
                this.clearAllTimers();

                // 清除所有事件订阅
                this.clearAllSubscriptions();

                // 重置状态
                const conditionState: ConditionState = {
                    messageCount: 0,
                    correctAnswerCount: 0,
                    wrongAnswerCount: 0,
                    lastEventId: '',
                    customFlags: {},
                    userAnswers: {}
                };

                this.setData({
                    messages: [],
                    formattedMessages: [],
                    isComplete: false,
                    isPlaying: false,
                    showAssessment: false,
                    currentAssessment: null,
                    currentEventId: '',
                    conditionState,
                    allowInput: true // 确保重启后可以输入
                });

                this.triggerEvent('restart');

                // 如果设置了自动播放，则开始播放
                if (this.properties.autoPlay) {
                    this.startPlayback();
                }
            } catch (e) {
                console.error('Failed to restart:', e);
                wx.showToast({
                    title: '重新开始失败',
                    icon: 'none'
                });
            } finally {
                wx.hideLoading();
            }
        },

        // 跳过当前事件
        onSkipNext() {
            if (this.data.isPlaying) {
                // 如果当前正在播放，取消当前正在处理的事件的所有定时器，并直接转到下一个
                this.clearAllTimers();

                const currentEvent = this.data.eventMap[this.data.currentEventId];
                if (currentEvent) {
                    this.transitionToNextEvent(currentEvent);
                }
            } else {
                // 如果当前暂停，则恢复播放
                this.resumePlayback();
            }
        },

        // 返回上一页
        onBack() {
            // 清除所有定时器和订阅
            this.clearAllTimers();
            this.clearAllSubscriptions();

            wx.navigateBack();
        },

        // 处理输入变更
        onInputChange(e: WechatMiniprogram.Input) {
            this.setData({
                inputText: e.detail.value
            });
        },

        // 发送消息
        onSendMessage() {
            if (!this.data.inputText.trim()) return;

            const content = this.data.inputText.trim();
            const now = new Date().getTime();

            console.log(`用户发送消息: ${content}`);

            // 创建一条新消息
            const newMessage: EventMessage = {
                id: `user-msg-${now}`,
                type: "message",
                role: "self",
                content
            };

            // 添加到消息列表
            const messages = [...this.data.messages, newMessage];
            const formattedMessages = this.formatMessages(messages);

            // 更新条件状态
            const conditionState = { ...this.data.conditionState };
            conditionState.messageCount++;
            conditionState.lastEventId = newMessage.id;

            // 分析用户消息内容，设置相应的标志
            this.analyzeUserMessage(content, conditionState);

            // 清空输入框并更新消息列表，确保输入区域保持启用状态
            this.setData({
                inputText: '',
                messages,
                formattedMessages,
                conditionState,
                scrollToView: `msg-${messages.length - 1}`,
                allowInput: true // 保持输入区域启用
            });

            // 触发自定义发送消息事件
            this.triggerEvent('messageSent', { message: newMessage });

            // 如果当前是评估对话框，关闭它
            if (this.data.showAssessment) {
                this.setData({
                    showAssessment: false,
                    currentAssessment: null
                });
            }

            // 发送消息后检查是否有条件转换需要执行
            if (this.data.currentEventId) {
                console.log('用户消息后检查条件转换');
                const currentEvent = this.data.eventMap[this.data.currentEventId];
                if (currentEvent) {
                    // 取消当前事件的所有计时器
                    this.clearAllTimers();
                    // 立即处理转换
                    this.transitionToNextEvent(currentEvent);
                }
            }
        },

        // 分析用户消息并设置相应的标志
        analyzeUserMessage(content: string, conditionState: ConditionState) {
            // 将消息内容转为小写，便于分析
            const lowerContent = content.toLowerCase();

            console.log(`分析用户消息内容: ${lowerContent}`);

            // 解析用户选择的主题
            if (lowerContent.includes('网络') || lowerContent.includes('安全') || lowerContent.includes('网安') || lowerContent.includes('1') || lowerContent.includes('一')) {
                console.log('用户选择了网络安全主题');
                conditionState.customFlags.userSelectedTopic = 'cyber';
            } else if (lowerContent.includes('健康') || lowerContent.includes('生活') || lowerContent.includes('2') || lowerContent.includes('二')) {
                console.log('用户选择了健康建议主题');
                conditionState.customFlags.userSelectedTopic = 'health';
            } else if (lowerContent.includes('财务') || lowerContent.includes('金融') || lowerContent.includes('财经') || lowerContent.includes('3') || lowerContent.includes('三')) {
                console.log('用户选择了金融知识主题');
                conditionState.customFlags.userSelectedTopic = 'finance';
            }

            // 解析用户最终选择
            if (lowerContent.includes('继续') || lowerContent.includes('yes') || lowerContent.includes('是') || lowerContent.includes('好')) {
                console.log('用户选择继续浏览其他主题');
                conditionState.customFlags.userFinalChoice = 'continue';
            } else if (lowerContent.includes('结束') || lowerContent.includes('no') || lowerContent.includes('否') || lowerContent.includes('退出')) {
                console.log('用户选择结束演示');
                conditionState.customFlags.userFinalChoice = 'end';
            }

            // 更新条件状态
            this.setData({ conditionState });
        },

        // 处理评估选项
        handleAssessmentOption(e: WechatMiniprogram.TouchEvent) {
            const option = e.currentTarget.dataset.option;
            this.setData({
                userAnswer: option
            });
        },

        // 提交评估答案
        submitAssessment() {
            if (!this.data.userAnswer || !this.data.currentAssessment) return;

            const { currentAssessment, userAnswer } = this.data;
            const isCorrect = userAnswer === currentAssessment.correctAnswer;

            // 更新条件状态
            const conditionState = { ...this.data.conditionState };

            // 记录用户答案
            if (currentAssessment.id) {
                conditionState.userAnswers[currentAssessment.id] = userAnswer;
            }

            // 更新正确/错误答案计数
            if (isCorrect) {
                conditionState.correctAnswerCount++;
            } else {
                conditionState.wrongAnswerCount++;
            }

            conditionState.lastEventId = currentAssessment.id;

            // 显示结果
            this.setData({
                showAssessmentResult: true,
                conditionState
            });

            // 延迟关闭评估对话框并继续播放
            const timerId = setTimeout(() => {
                // 从活动定时器列表中移除
                const activeTimers = [...this.data.activeTimers];
                const timerIndex = activeTimers.indexOf(timerId);
                if (timerIndex !== -1) {
                    activeTimers.splice(timerIndex, 1);
                    this.setData({ activeTimers });
                }

                this.setData({
                    showAssessment: false,
                    currentAssessment: null,
                    isPlaying: true
                });

                this.transitionToNextEvent(currentAssessment);
            }, 2000);

            // 添加到活动定时器列表
            this.setData({
                activeTimers: [...this.data.activeTimers, timerId]
            });
        },

        // 处理等待用户交互的事件
        handleWaitingForInputEvent(event: EventMessage) {
            console.log(`处理等待用户输入事件: ${event.id}`);

            // 更新条件状态
            const conditionState = { ...this.data.conditionState };
            conditionState.lastEventId = event.id;

            // 设置自定义标志
            if (event.setFlags && typeof event.setFlags === 'object') {
                console.log(`设置自定义标志:`, event.setFlags);
                for (const [key, value] of Object.entries(event.setFlags)) {
                    conditionState.customFlags[key] = value;
                }
            }

            // 更新状态
            this.setData({
                conditionState,
                allowInput: true // 确保用户可以输入
            });

            // 等待用户输入的事件不会自动转到下一个事件，需要用户交互触发
        },

        // 处理UI高亮事件
        handleUIHighlightEvent(event: EventMessage) {
            console.log(`处理UI高亮事件: ${event.id}`);

            // 获取要高亮的目标元素
            const targetElement = event.highlightTarget;
            console.log(`要高亮的目标元素: ${targetElement}`);

            // 更新条件状态
            const conditionState = { ...this.data.conditionState };
            conditionState.lastEventId = event.id;

            // 设置高亮状态
            this.setData({
                highlightTarget: targetElement,
                showHighlight: true,
                conditionState
            });

            // 延迟转到下一个事件
            const delay = event.delay || 500;
            if (delay > 0) {
                const adjustedDelay = delay / this.properties.playbackSpeed;
                const timerId = setTimeout(() => {
                    this.transitionToNextEvent(event);
                }, adjustedDelay);

                // 添加到活动计时器列表
                this.setData({
                    activeTimers: [...this.data.activeTimers, timerId]
                });
            } else {
                // 立即转到下一个事件
                this.transitionToNextEvent(event);
            }
        },

        // 组件挂载
        attached() {
            console.log('事件播放器组件已加载');
            // 初始化空的订阅映射
            this.setData({ _eventSubscriptions: {} });
        },

        // 组件卸载
        detached() {
            console.log('事件播放器组件已卸载，清理资源');
            // 清除所有计时器和订阅
            this.clearAllTimers();
            this.clearAllSubscriptions();
        },

        // 处理加号按钮点击
        onPlusClick() {
            console.log('用户点击了加号按钮');
            console.log('当前高亮状态:', {
                highlightTarget: this.data.highlightTarget,
                showHighlight: this.data.showHighlight
            });

            // 检查是否在等待用户点击加号
            if (this.data.highlightTarget === 'more-button' && this.data.showHighlight) {
                console.log('检测到加号点击，更新标志状态');

                // 更新条件状态
                const conditionState = { ...this.data.conditionState };
                conditionState.customFlags = conditionState.customFlags || {};
                conditionState.customFlags.userClickedPlus = true;

                console.log('新的条件状态:', conditionState);

                // 更新状态并隐藏高亮
                this.setData({
                    conditionState,
                    showHighlight: false
                }, () => {
                    // 在状态更新完成后检查转换
                    console.log('状态已更新，检查转换');
                    this.checkAndTransitionBasedOnFlags();
                });
            } else {
                console.log('加号点击，但不在等待点击状态');
            }
        },

        // 处理功能按钮点击
        onFeatureClick(e: WechatMiniprogram.CustomEvent) {
            const feature = e.detail.feature;
            console.log('用户点击了功能按钮:', feature);
            console.log('当前高亮状态:', {
                highlightTarget: this.data.highlightTarget,
                showHighlight: this.data.showHighlight
            });

            // 检查是否在等待用户点击红包按钮
            if (feature === 'redpacket' && this.data.highlightTarget === 'redpacket' && this.data.showHighlight) {
                console.log('检测到红包按钮点击，更新标志状态');

                // 更新条件状态
                const conditionState = { ...this.data.conditionState };
                conditionState.customFlags = conditionState.customFlags || {};
                conditionState.customFlags.userClickedRedPacket = true;

                console.log('新的条件状态:', conditionState);

                // 更新状态并隐藏高亮
                this.setData({
                    conditionState,
                    showHighlight: false
                }, () => {
                    // 在状态更新完成后检查转换
                    console.log('状态已更新，检查转换');
                    this.checkAndTransitionBasedOnFlags();
                });
            } else {
                console.log('功能按钮点击，但不是等待中的红包按钮');
            }
        },

        // 检查标志并根据条件转到下一个事件
        checkAndTransitionBasedOnFlags() {
            const { conditionState, currentEventId } = this.data;
            const currentEvent = this.data.eventMap[currentEventId];

            console.log('检查标志并转换:', {
                currentEventId,
                flags: conditionState.customFlags,
                hasUserClickedPlus: conditionState.customFlags.userClickedPlus
            });

            if (!currentEvent) {
                console.error('当前事件不存在:', currentEventId);
                return;
            }

            // 检查是否有转换
            if (currentEvent.transitions && currentEvent.transitions.length > 0) {
                console.log(`事件 ${currentEventId} 有 ${currentEvent.transitions.length} 个可能的转换`);

                // 查找匹配条件的转换
                for (const transition of currentEvent.transitions) {
                    if (!transition.conditions || transition.conditions.length === 0) {
                        // 无条件转换
                        console.log(`找到无条件转换到 ${transition.targetId}`);
                        this.processEvent(transition.targetId);
                        return;
                    }

                    // 检查所有条件是否满足
                    const conditionResults = transition.conditions.map(condition => {
                        const result = this.evaluateCondition(condition);
                        console.log(`条件检查 ${condition.type} ${condition.key || ''}: ${result}`);
                        return result;
                    });

                    const allConditionsMet = conditionResults.every(result => result === true);

                    if (allConditionsMet) {
                        // 条件满足，转到目标事件
                        console.log(`所有条件满足，转换到 ${transition.targetId}`);
                        this.processEvent(transition.targetId);
                        return;
                    } else {
                        console.log(`条件不满足，不能转换到 ${transition.targetId}`);
                    }
                }

                console.log('没有找到满足条件的转换，保持当前状态');
            } else {
                console.log(`事件 ${currentEventId} 没有定义任何转换`);
            }
        },

        // 处理红包发送
        onRedpacketSend(e: WechatMiniprogram.CustomEvent) {
            console.log('收到红包发送事件', e.detail);

            // 可以在这里处理红包发送后的业务逻辑
            // 例如添加一条红包消息到聊天中
            const redpacketData = e.detail;

            // 创建一个新的消息
            const newMessage: EventMessage = {
                id: `msg-${Date.now()}`,
                type: 'redpacket_message',
                role: 'self',
                content: `发送了一个红包: ${redpacketData.greeting}`
            };

            // 添加消息到消息列表
            const messages = [...this.data.messages, newMessage];
            const formattedMessages = this.formatMessages(messages);

            // 更新数据
            this.setData({
                messages,
                formattedMessages,
                scrollToView: `msg-${formattedMessages.length - 1}`
            });
        },

        // 处理表情选择
        onSelectEmoji(e: WechatMiniprogram.CustomEvent) {
            const emoji = e.detail.emoji;
            console.log('选择了表情:', emoji);
            
            // 将表情添加到当前输入文本中
            const newInputText = this.data.inputText + emoji;
            
            this.setData({
                inputText: newInputText
            });
        },
        
        // 处理表情删除
        onDeleteEmoji() {
            if (this.data.inputText.length > 0) {
                // 使用Array.from将字符串拆分为Unicode字符（包括表情），
                // 然后删除最后一个字符或表情
                const characters = Array.from(this.data.inputText);
                characters.pop();
                
                this.setData({
                    inputText: characters.join('')
                });
            }
        }
    }
}); 