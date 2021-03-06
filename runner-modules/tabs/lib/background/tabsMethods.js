'use strict';
const {illegalArgumentError, newPageWaitTimeoutError, CONTENT_SCRIPT_ABORTED_ERROR} = require('../../../../lib/scriptErrors');
const delay = require('../../../../lib/delay');

const ALLOWED_URL_REGEXP = /^https?:\/\//;

module.exports = (tabManager) => {
    const createTab = async () => {
        // creating a tab has a lot of overhead, so we do not allow the runner script to pass an url here (the url is always about:blank)
        // this lets us create tabs outside of the transaction block, while the navigation is within the block
        const tab = await tabManager.createTab();
        return tab.id;
    };

    const navigateTab = async ({id, url}) => {
        if (typeof id !== 'string' || !tabManager.hasTab(id)) {
            throw illegalArgumentError('tabs.navigate(): invalid argument `id`');
        }
        if (typeof url !== 'string' || !ALLOWED_URL_REGEXP.test(url)) {
            throw illegalArgumentError('tabs.navigate(): `url` argument must be an absolute HTTP URL');
        }

        return await tabManager.navigateTab(id, url);
    };

    const run = async ({id, code, arg}) => {
        if (typeof id !== 'string' || !tabManager.hasTab(id)) {
            throw illegalArgumentError('tabs.run(): invalid argument `id`');
        }

        if (typeof code !== 'string') {
            throw illegalArgumentError('tabs.run(): invalid argument `code`');
        }

        const metadata = Object.freeze({
            runBeginTime: Date.now(),
        });

        return await tabManager.runContentScript(id, code, {arg, metadata});
    };

    const waitForNewPage = async ({id, code, arg, timeoutMs}) => {
        if (typeof id !== 'string' || !tabManager.hasTab(id)) {
            throw illegalArgumentError('tabs.run(): invalid argument `id`');
        }

        if (typeof code !== 'string') {
            throw illegalArgumentError('tabs.run(): invalid argument `code`');
        }

        const metadata = Object.freeze({
            runBeginTime: Date.now(),
        });

        const waitForNewContentPromise = tabManager.waitForNewContent(id);
        try {
            const {reject} = await tabManager.runContentScript(id, code, {arg, metadata});
            // do not return `resolve` to avoid timing inconsistencies (e.g. the script may have been canceled because of the navigation)
            if (reject) {
                return {reject};
            }
        }
        catch (err) {
            // ignore errors which are caused by navigation away; that is what we are expecting
            if (err.name !== CONTENT_SCRIPT_ABORTED_ERROR) {
                throw err;
            }
        }

        // the timeout does not start counting until the content script has completed its execution; this is by design
        await Promise.race([
            waitForNewContentPromise,
            delay(timeoutMs).then(() => Promise.reject(
                newPageWaitTimeoutError(`Waiting for a new page timed out after ${timeoutMs / 1000} seconds`)
            )),
        ]);

        return {reject: null};
    };

    const wait = async ({id, code, arg}) => {
        if (typeof id !== 'string' || !tabManager.hasTab(id)) {
            throw illegalArgumentError('tabs.wait(): invalid argument `id`');
        }

        if (typeof code !== 'string') {
            throw illegalArgumentError('tabs.wait(): invalid argument `code`');
        }

        const waitMetadata = Object.freeze({
            waitBeginTime: Date.now(),
        });

        const attempt = async (attemptNumber) => {
            try {
                const metadata = Object.assign({
                    attemptNumber,
                    runBeginTime: Date.now(),
                }, waitMetadata);
                return await tabManager.runContentScript(id, code, {arg, metadata});
            }
            catch (err) {
                if (err.name === CONTENT_SCRIPT_ABORTED_ERROR) {
                    // runContentScript wait for a new tab to initialize
                    return await attempt(attemptNumber + 1);
                }

                throw err;
            }
        };

        return await attempt(0);
    };

    return new Map([
        ['tabs.create', createTab],
        ['tabs.navigate', navigateTab],
        ['tabs.run', run],
        ['tabs.wait', wait],
        ['tabs.waitForNewPage', waitForNewPage],
    ]);
};
