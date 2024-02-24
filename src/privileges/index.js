'use strict';

const db = require('/home/jublizoo/17313/spring24-nodebb-orange-fruit/src/database/index');
const Users = require('/home/jublizoo/17313/spring24-nodebb-orange-fruit/src/user/index');

const privileges = module.exports;
privileges.global = require('./global');
privileges.admin = require('./admin');
privileges.categories = require('./categories');
privileges.topics = require('./topics');
privileges.posts = require('./posts');
privileges.users = require('./users');

//No parameters, and void return type - no need for such assertions
privileges.init = async () => {
    let users = await db.getSortedSetRangeWithScores('users:joindate', 0, -1);
    users = users.map(user => user.value);

    for (let uid of users) {
        const userInfo = await Users.getUserField(uid, 'accounttype');
        const isTA = (userInfo === 'TA');
        const isInstructor = (userInfo === 'instructor');
        
        if (isTA || isInstructor) {
            privileges.global.give(['mute'], [uid]);
        }
        if (isInstructor) {
            privileges.global.give(['ban'], [uid])
        }
    } 

    await privileges.global.init();
    await privileges.admin.init();
    await privileges.categories.init();
};

require('../promisify')(privileges);
