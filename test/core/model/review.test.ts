import { describe, expect, it } from 'vitest';
import {
  canComment, canEditVersions, canPerform, isReviewPackage, nextReviewStatus, reviewShareLink,
  type ReviewStatus, type ReviewRole,
} from '@/model/review';

describe('review workflow transitions', () => {
  it('draft can be submitted and changes requested can be resubmitted', () => {
    expect(nextReviewStatus('draft', 'submit')).toBe('inReview');
    expect(nextReviewStatus('changesRequested', 'submit')).toBe('inReview');
  });

  it('in-review can be approved or sent back', () => {
    expect(nextReviewStatus('inReview', 'approve')).toBe('approved');
    expect(nextReviewStatus('inReview', 'requestChanges')).toBe('changesRequested');
  });

  it('an approved project reopens into review', () => {
    expect(nextReviewStatus('approved', 'reopen')).toBe('inReview');
  });

  it('rejects actions the stage does not allow', () => {
    expect(nextReviewStatus('draft', 'approve')).toBeNull();
    expect(nextReviewStatus('approved', 'submit')).toBeNull();
    expect(nextReviewStatus('changesRequested', 'requestChanges')).toBeNull();
  });

  it('every reachable status is one of the four stages', () => {
    const stages: ReviewStatus[] = ['draft', 'inReview', 'approved', 'changesRequested'];
    for (const stage of stages) {
      for (const action of ['submit', 'approve', 'requestChanges', 'reopen'] as const) {
        const target = nextReviewStatus(stage, action);
        if (target) expect(stages).toContain(target);
      }
    }
  });
});

describe('review permissions', () => {
  const cases: Array<[ReviewRole, boolean, boolean]> = [
    ['owner', true, true],
    ['reviewer', true, false],
    ['viewer', false, false],
  ];

  it('gates comments and versions per role', () => {
    for (const [role, comment, versions] of cases) {
      expect(canComment(role)).toBe(comment);
      expect(canEditVersions(role)).toBe(versions);
    }
  });

  it('only owners submit and reopen', () => {
    for (const role of ['reviewer', 'viewer'] as ReviewRole[]) {
      expect(canPerform(role, 'submit')).toBe(false);
      expect(canPerform(role, 'reopen')).toBe(false);
    }
    expect(canPerform('owner', 'submit')).toBe(true);
  });

  it('owners and reviewers can approve or send back', () => {
    expect(canPerform('owner', 'approve')).toBe(true);
    expect(canPerform('reviewer', 'approve')).toBe(true);
    expect(canPerform('reviewer', 'requestChanges')).toBe(true);
    expect(canPerform('viewer', 'approve')).toBe(false);
  });
});

describe('review sharing', () => {
  it('builds a hash link without dropping the current path', () => {
    expect(reviewShareLink('https://example.com', '/app', 'cloud-1'))
      .toBe('https://example.com/app#review=cloud-1');
    expect(reviewShareLink('https://example.com', '/', 'a b')
      .endsWith('#review=a%20b')).toBe(true);
  });

  it('accepts only well-formed review packages', () => {
    const valid = {
      format: 'opencloth-review',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      exportedBy: 'tester',
      project: {
        id: 'p', name: 'p', owner: 'o', createdAt: '', updatedAt: '',
        status: 'draft', sharedRole: 'reviewer', latestSeq: 1, versionCount: 1,
      },
      snapshot: '{}',
      comments: [],
      events: [],
    };
    expect(isReviewPackage(valid)).toBe(true);
    expect(isReviewPackage({ ...valid, format: 'other' })).toBe(false);
    expect(isReviewPackage({ ...valid, version: 2 })).toBe(false);
    expect(isReviewPackage({ ...valid, snapshot: 3 })).toBe(false);
    expect(isReviewPackage({ ...valid, comments: 'x' })).toBe(false);
    expect(isReviewPackage(null)).toBe(false);
  });
});
