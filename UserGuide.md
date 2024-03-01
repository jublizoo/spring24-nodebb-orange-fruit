# Feature: Non-student Accounts Do Not Have Minimum Reputation Limits to Post

To prevent newbies from spam posting, student accounts with less than 3 reputation points must wait 120 seconds between making new posts. However, admin, TAs, and instructors now do not have to wait between posts, even with less than 3 reputation points.

## User Tests
To test this feature, build and run NodeBB (see readme), and create 3 accounts: one student, one instructor, and one TA.

When logged in as a student:
1. Ensure the account’s reputation is less than 3. To check the reputation of an account, click the profile image in the top right corner, then the username in the dropdown, and the account information will appear. (When creating a new account, it will have 0 reputation by default.)

![image](https://drive.google.com/uc?export=view&id=1tpuR9pJKu6PaDV2Qfu_LUTTXe3r5Z2EZ)

2. Create a new post in General Discussion, either a new topic or a reply to another topic. 
3. Immediately (within the next 120 seconds), create a new post. You should see an error like this: 

![image](https://drive.google.com/uc?export=view&id=1GhmgArMq-aqQEJeboDPo-wIswN1BGyB0)

So we can indeed confirm that the reputation limit still exists for student accounts. However, this shouldn’t happen for instructors and TAs.

For the instructor and TA accounts, follow the above procedure. This time, however, you should not get that same error, allowing you to create multiple posts within 120 seconds.

## Automated Tests
The testing suite includes test cases that create student, instructor, and TA accounts and attempts to create multiple posts within the newbie post delay threshold for these accounts. These test cases can be found in [src/test/user.js](src/test/user.js).

# Feature: New TA account type which is displayed on profile and posts

## User Tests
To test this feature automatically, see tests in [tests/topics.js](test/topics.js) on lines 139-149 and 190-204. This tests the creation of the account then also tests one permission (TA account can post announcements) to ensure that the account actually uses those permissions. This is sufficient because if no error was generated when making a TA account and testing it, the account type is valid and works.
To test this feature manually, build and run NodeBB (see readme), and create an account of any type (you will be able to choose between a student, TA, and instructor account type). Then, create a post. There are two ways to view a user’s account type.

![image](https://drive.google.com/uc?export=view&id=1khswyh9GNdvvn3kVcvUJBd7dugnDzwwt)

When on a user’s profile: 
1. Click on their username and this will hyperlink to the user’s page. You can view the account type at the bottom of the page. 

![image](https://drive.google.com/uc?export=view&id=1WYb9gEofqQ1sq0-GO5BBazA9RrLVNXiN)

The TA account type supports permissions in between a student and instructor account type which will allow teaching assistants to only execute required tasks and functions. 

# Feature: Support LaTeX rendering

## User Tests
To test this feature automatically, see tests on Github Actions. The code for the added tests can be found here: [https://github.com/CMU-313/spring24-nodebb-orange-fruit/pull/21/files](https://github.com/CMU-313/spring24-nodebb-orange-fruit/pull/21/files). The rationale for the test cases is that correctly running this feature should ensure no $.$ content in the final math expression. This may be strengthened in the future by comparing the result with pre-computed values, but this approach may give false negatives since different ways of rendering the symbols can yield the same result.

This should be sufficient to check this feature. The KaTeX library will throw an error if it encounters a math symbol it cannot render, which should throw an error when post.sanitize is called.

To test this feature manually, build and run NodeBB (see readme), and craft a post (either create a new one or reply to an existing one).

This feature supports two ways of rendering TeX: with either $`\$`$.$`\$`$-style statements for inline math, and $`\$\$`$.$`\$\$`$-style statements for display mode math. An example of the rendering is as follows:

![image](https://drive.google.com/uc?export=view&id=12u-D7R87uQfh9UR3l8kuFWGX3fKd6Rqs)


Additionally, this feature works for text previews, so students can see how accurate their symbols are before needing to post.

# Feature: Students do not have permission to post in announcements


