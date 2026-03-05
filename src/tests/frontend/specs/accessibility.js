'use strict';

describe('Accessibility ARIA attributes', function () {
    before(async function () {
        await helper.aNewPad();
    });

    it('checks if ARIA attributes are present when enabled (default)', async function () {
        const chrome$ = helper.padChrome$;
        const outer$ = helper.padOuter$;
        const inner$ = helper.padInner$;

        // Outer frame
        const outerFrame = chrome$('iframe[name="ace_outer"]');
        expect(outerFrame.attr('role')).to.be('application');
        expect(outerFrame.attr('aria-label')).to.be('Etherpad editor');

        // Inner frame
        const innerFrame = outer$('iframe[name="ace_inner"]');
        expect(innerFrame.attr('role')).to.be('document');
        expect(innerFrame.attr('aria-label')).to.be('Pad content');

        // Inner doc body
        const innerBody = inner$('body#innerdocbody');
        expect(innerBody.attr('role')).to.be('textbox');
        expect(innerBody.attr('aria-multiline')).to.be('true');
        expect(innerBody.attr('aria-label')).to.be('Pad content');
    });
});
