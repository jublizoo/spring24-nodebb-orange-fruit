
'use strict';

const Iroh = require('iroh');
const _ = require('lodash');
const assert = require('assert');
const db = require('../database');
const utils = require('../utils');
const slugify = require('../slugify');
const plugins = require('../plugins');
const analytics = require('../analytics');
const user = require('../user');
const meta = require('../meta');
const posts = require('../posts');
const privileges = require('../privileges');
const categories = require('../categories');
const translator = require('../translator');


module.exports = function (Topics) {
    Topics.create = async function (data) {
        // This is an internal method, consider using Topics.post instead
        const timestamp = data.timestamp || Date.now();

        const tid = await db.incrObjectField('global', 'nextTid');

        let topicData = {
            tid: tid,
            uid: data.uid,
            cid: data.cid,
            mainPid: 0,
            title: data.title,
            slug: `${tid}/${slugify(data.title) || 'topic'}`,
            timestamp: timestamp,
            lastposttime: 0,
            postcount: 0,
            viewcount: 0,
        };

        if (Array.isArray(data.tags) && data.tags.length) {
            topicData.tags = data.tags.join(',');
        }

        const result = await plugins.hooks.fire('filter:topic.create', { topic: topicData, data: data });
        topicData = result.topic;
        await db.setObject(`topic:${topicData.tid}`, topicData);

        const timestampedSortedSetKeys = [
            'topics:tid',
            `cid:${topicData.cid}:tids`,
            `cid:${topicData.cid}:uid:${topicData.uid}:tids`,
        ];

        const scheduled = timestamp > Date.now();
        if (scheduled) {
            timestampedSortedSetKeys.push('topics:scheduled');
        }

        await Promise.all([
            db.sortedSetsAdd(timestampedSortedSetKeys, timestamp, topicData.tid),
            db.sortedSetsAdd([
                'topics:views', 'topics:posts', 'topics:votes',
                `cid:${topicData.cid}:tids:votes`,
                `cid:${topicData.cid}:tids:posts`,
                `cid:${topicData.cid}:tids:views`,
            ], 0, topicData.tid),
            user.addTopicIdToUser(topicData.uid, topicData.tid, timestamp),
            db.incrObjectField(`category:${topicData.cid}`, 'topic_count'),
            db.incrObjectField('global', 'topicCount'),
            Topics.createTags(data.tags, topicData.tid, timestamp),
            scheduled ? Promise.resolve() : categories.updateRecentTid(topicData.cid, topicData.tid),
        ]);
        if (scheduled) {
            await Topics.scheduled.pin(tid, topicData);
        }

        plugins.hooks.fire('action:topic.save', { topic: _.clone(topicData), data: data });
        return topicData.tid;
    };


    /*  @param data : {
            uid : string | number
            title: string,
            tags? : string[],
            content : string,
            cid : string | number
            fromQueue? : boolean,
            req? : {ip : string}
        }
        @return {
            postData : {
                ip : string
                tid : number,
                user : User,
                index: number,
                isMain : boolean,
            },
            topicData : {
                index : number,
                cid : number,
                unreplied : boolean,
                mainPost? : {
                    ip? : string
                    tid : number,
                    user : User,
                    index: number,
                    isMain : boolean,
                },
                scheduled : boolean
            }
        }
    */
    Topics.post = async function (data) {
        const stage = new Iroh.Stage('Topics.create(data)');

        const listener = stage.addListener(Iroh.CALL);
        listener.on('before', () => {
            console.log('Calling topics.create');
        });
        listener.on('after', () => {
            console.log('Called topics.create');
        });

        const stage2 = new Iroh.Stage('if (data.content) {data.content = utils.rtrim(data.content);}');
        const loopListener = stage2.addListener(Iroh.IF);
        loopListener.on('enter', () => {
            console.log('Entering if');
        });
        loopListener.on('leave', () => {
            console.log('Leaving if');
        });

        // Next 2 lines must run, despite the linter saying it is unsafe.
        // eslint-disable-next-line
        eval(stage.script);
        // eslint-disable-next-line
        eval(stage2.script);

        /*
         * Ensure input types are correct. Some inputs change types across calls.
         * Certain errors are expected when required data is not given, hence
         * the option for types to be null/invalid in the type assertions.
         */
        assert(!data.uid || typeof data.uid === 'number' || typeof data.uid === 'string');
        assert(!data.title || typeof data.title === 'string');
        assert(!data.tags || typeof data.tags === 'object');
        assert(!data.content || typeof data.content === 'string');
        assert(!data.cid || typeof data.cid === 'number' || typeof data.cid === 'string');
        assert(!data.fromQueue || typeof data.fromQueue === 'boolean');
        assert(!data.req || !data.req.ip || typeof data.req.ip === 'string');

        data = await plugins.hooks.fire('filter:topic.post', data);
        const { uid } = data;

        data.title = String(data.title).trim();
        data.tags = data.tags || [];
        if (data.content) {
            data.content = utils.rtrim(data.content);
        }
        Topics.checkTitle(data.title);
        await Topics.validateTags(data.tags, data.cid, uid);
        data.tags = await Topics.filterTags(data.tags, data.cid);
        if (!data.fromQueue) {
            Topics.checkContent(data.content);
        }

        const [categoryExists, canCreate, canTag] = await Promise.all([
            categories.exists(data.cid),
            privileges.categories.can('topics:create', data.cid, uid),
            privileges.categories.can('topics:tag', data.cid, uid),
        ]);


        if (!categoryExists) {
            throw new Error('[[error:no-category]]');
        }

        let isStudentAnnouncement = false;
        if (uid && user.exists(uid)) {
            const userInfo = await user.getUserField(uid, 'accounttype');
            const category = await categories.getCategoryData(data.cid);

            assert(typeof userInfo === 'string');
            assert(category.hasOwnProperty('name'));
            assert(typeof category.name === 'string');

            const isStudent = (userInfo === 'student');
            const isAnnouncement = (category.name === 'Announcements');
            isStudentAnnouncement = isStudent && isAnnouncement;
        }

        if (!canCreate || isStudentAnnouncement || (!canTag && data.tags.length)) {
            throw new Error('[[error:no-privileges]]');
        }

        await guestHandleValid(data);
        if (!data.fromQueue) {
            await user.isReadyToPost(uid, data.cid);
        }

        const tid = await Topics.create(data);

        let postData = data;
        postData.tid = tid;
        postData.ip = data.req ? data.req.ip : null;
        postData.isMain = true;
        postData = await posts.create(postData);
        postData = await onNewPost(postData, data);

        const [settings, topics] = await Promise.all([
            user.getSettings(uid),
            Topics.getTopicsByTids([postData.tid], uid),
        ]);

        if (!Array.isArray(topics) || !topics.length) {
            throw new Error('[[error:no-topic]]');
        }

        if (uid > 0 && settings.followTopicsOnCreate) {
            await Topics.follow(postData.tid, uid);
        }
        const topicData = topics[0];
        topicData.unreplied = true;
        topicData.mainPost = postData;
        topicData.index = 0;
        postData.index = 0;

        if (topicData.scheduled) {
            await Topics.delete(tid);
        }

        analytics.increment(['topics', `topics:byCid:${topicData.cid}`]);
        plugins.hooks.fire('action:topic.post', { topic: topicData, post: postData, data: data });

        if (parseInt(uid, 10) && !topicData.scheduled) {
            user.notifications.sendTopicNotificationToFollowers(uid, topicData, postData);
        }

        assert(!postData.ip || typeof postData.ip === 'string');
        assert(typeof postData.tid === 'number');
        assert(typeof postData.user === 'object');
        assert(typeof postData.index === 'number');
        assert(typeof postData.isMain === 'boolean');
        assert(typeof topicData.index === 'number');
        assert(typeof topicData.cid === 'number');
        assert(typeof topicData.unreplied === 'boolean');
        assert(!topicData.mainPost.ip || typeof topicData.mainPost.ip === 'string');
        assert(typeof topicData.mainPost.tid === 'number');
        assert(typeof topicData.mainPost.user === 'object');
        assert(typeof topicData.mainPost.index === 'number');
        assert(typeof topicData.mainPost.isMain === 'boolean');
        assert(typeof topicData.scheduled === 'boolean');

        return {
            topicData: topicData,
            postData: postData,
        };
    };

    /*  @param data : {
            uid : number,
            content : string,
            tid : number,
            cid : number,
            fromQueue? : boolean,
            timestamp: number | Date,
            ip : string,
        }

        @return postData : {
            tid : number,
            user : User
            topic : {title : string, pid : number, tid : number}
        }
    */
    Topics.reply = async function (data) {
        assert.strictEqual(typeof parseInt(data.uid, 10), 'number');
        assert.strictEqual(typeof data.content, 'string');
        assert.strictEqual(typeof parseInt(data.tid, 10), 'number');
        assert.strictEqual(typeof parseInt(data.cid, 10), 'number');
        assert.strictEqual(typeof parseInt(data.timestamp, 10), 'number');

        data = await plugins.hooks.fire('filter:topic.reply', data);
        const { tid } = data;
        const { uid } = data;

        const topicData = await Topics.getTopicData(tid);

        await canReply(data, topicData);

        data.cid = topicData.cid;

        await guestHandleValid(data);
        if (data.content) {
            data.content = utils.rtrim(data.content);
        }
        if (!data.fromQueue) {
            await user.isReadyToPost(uid, data.cid);
            Topics.checkContent(data.content);
        }

        // For replies to scheduled topics, don't have a timestamp older than topic's itself
        if (topicData.scheduled) {
            data.timestamp = topicData.lastposttime + 1;
        }

        data.ip = data.req ? data.req.ip : null;
        let postData = await posts.create(data);
        postData = await onNewPost(postData, data);

        const settings = await user.getSettings(uid);
        if (uid > 0 && settings.followTopicsOnReply) {
            await Topics.follow(postData.tid, uid);
        }

        if (parseInt(uid, 10)) {
            user.setUserField(uid, 'lastonline', Date.now());
        }

        if (parseInt(uid, 10) || meta.config.allowGuestReplyNotifications) {
            const { displayname } = postData.user;

            Topics.notifyFollowers(postData, uid, {
                type: 'new-reply',
                bodyShort: translator.compile('notifications:user_posted_to', displayname, postData.topic.title),
                nid: `new_post:tid:${postData.topic.tid}:pid:${postData.pid}:uid:${uid}`,
                mergeId: `notifications:user_posted_to|${postData.topic.tid}`,
            });
        }

        if (topicData.uid !== uid) {
            await user.incrementUserReputationBy(uid, 1);
        }

        analytics.increment(['posts', `posts:byCid:${data.cid}`]);
        plugins.hooks.fire('action:topic.reply', { post: _.clone(postData), data: data });

        assert.strictEqual(typeof parseInt(postData.tid, 10), 'number');
        assert.strictEqual(typeof postData.topic.title, 'string');
        assert.strictEqual(typeof parseInt(postData.pid, 10), 'number');
        assert.strictEqual(typeof parseInt(postData.topic.tid, 10), 'number');
        return postData;
    };

    // This function adds relevant data to post data for a new post, utilizing the uid and tid from data
    async function onNewPost(postData, data) {
        const { tid } = postData;
        const { uid } = postData;
        await Topics.markAsUnreadForAll(tid);
        await Topics.markAsRead([tid], uid);
        const [
            userInfo,
            topicInfo,
        ] = await Promise.all([
            posts.getUserInfoForPosts([postData.uid], uid),
            Topics.getTopicFields(tid, ['tid', 'uid', 'title', 'slug', 'cid', 'postcount', 'mainPid', 'scheduled']),
            Topics.addParentPosts([postData]),
            Topics.syncBacklinks(postData),
            posts.parsePost(postData),
        ]);

        postData.user = userInfo[0];
        postData.topic = topicInfo;
        postData.index = topicInfo.postcount - 1;

        posts.overrideGuestHandle(postData, data.handle);

        postData.votes = 0;
        postData.bookmarked = false;
        postData.display_edit_tools = true;
        postData.display_delete_tools = true;
        postData.display_moderator_tools = true;
        postData.display_move_tools = true;
        postData.selfPost = false;
        postData.timestampISO = utils.toISOString(postData.timestamp);
        postData.topic.title = String(postData.topic.title);

        return postData;
    }

    Topics.checkTitle = function (title) {
        check(title, meta.config.minimumTitleLength, meta.config.maximumTitleLength, 'title-too-short', 'title-too-long');
    };

    Topics.checkContent = function (content) {
        check(content, meta.config.minimumPostLength, meta.config.maximumPostLength, 'content-too-short', 'content-too-long');
    };

    function check(item, min, max, minError, maxError) {
        // Trim and remove HTML (latter for composers that send in HTML, like redactor)
        if (typeof item === 'string') {
            item = utils.stripHTMLTags(item).trim();
        }

        if (item === null || item === undefined || item.length < parseInt(min, 10)) {
            throw new Error(`[[error:${minError}, ${min}]]`);
        } else if (item.length > parseInt(max, 10)) {
            throw new Error(`[[error:${maxError}, ${max}]]`);
        }
    }

    async function guestHandleValid(data) {
        if (meta.config.allowGuestHandles && parseInt(data.uid, 10) === 0 && data.handle) {
            if (data.handle.length > meta.config.maximumUsernameLength) {
                throw new Error('[[error:guest-handle-invalid]]');
            }
            const exists = await user.existsBySlug(slugify(data.handle));
            if (exists) {
                throw new Error('[[error:username-taken]]');
            }
        }
    }

    async function canReply(data, topicData) {
        if (!topicData) {
            throw new Error('[[error:no-topic]]');
        }
        const { tid, uid } = data;
        const { cid, deleted, locked, scheduled } = topicData;

        const [canReply, canSchedule, isAdminOrMod] = await Promise.all([
            privileges.topics.can('topics:reply', tid, uid),
            privileges.topics.can('topics:schedule', tid, uid),
            privileges.categories.isAdminOrMod(cid, uid),
        ]);

        if (locked && !isAdminOrMod) {
            throw new Error('[[error:topic-locked]]');
        }

        if (!scheduled && deleted && !isAdminOrMod) {
            throw new Error('[[error:topic-deleted]]');
        }

        if (scheduled && !canSchedule) {
            throw new Error('[[error:no-privileges]]');
        }

        if (!canReply) {
            throw new Error('[[error:no-privileges]]');
        }
    }
};
