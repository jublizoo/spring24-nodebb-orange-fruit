'use strict';

const db = require('/home/jublizoo/17313/spring24-nodebb-orange-fruit/src/database/index');

const privileges = module.exports;
privileges.global = require('./global');
privileges.admin = require('./admin');
privileges.categories = require('./categories');
privileges.topics = require('./topics');
privileges.posts = require('./posts');
privileges.users = require('./users');

privileges.init = async () => {
    //privileges.global.give(['ban', 'mute'], [uid]);

    await privileges.global.init();
    await privileges.admin.init();
    await privileges.categories.init();
};

require('../promisify')(privileges);
