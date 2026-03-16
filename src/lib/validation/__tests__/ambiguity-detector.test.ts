import { describe, it, expect } from 'vitest';
import { detectAmbiguity } from '../ambiguity-detector';

describe('Ambiguity Detector', () => {
  it('flags qualitative terms like "fast"', () => {
    const result = detectAmbiguity('The system must be very fast.');
    expect(result.isAmbiguous).toBe(true);
    expect(result.flaggedTerms).toContain('fast');
  });

  it('flags vague terms like "scalable" or "secure"', () => {
    const result = detectAmbiguity('Needs to be highly scalable and secure.');
    expect(result.isAmbiguous).toBe(true);
    expect(result.flaggedTerms).toEqual(expect.arrayContaining(['scalable', 'secure']));
  });

  it('accepts quantitative metrics', () => {
    const result = detectAmbiguity('API response time must be under 200ms.');
    expect(result.isAmbiguous).toBe(false);
    expect(result.flaggedTerms).toHaveLength(0);
  });

  it('accepts specific industry standards', () => {
    const result = detectAmbiguity('Implement SOC2 compliant logging.');
    expect(result.isAmbiguous).toBe(false);
  });
});
- Item

- **File Path:** src/lib/validation/__tests__/prd-validator.test.ts
##### Content

import { describe, it, expect } from 'vitest';
import { validatePrdDraft } from '../prd-validator';

describe('PRD Draft Validator', () => {
  const validACs = [
    { id: '1', text: 'Latency < 200ms', status: 'APPROVED' },
    { id: '2', text: 'Supports 10k concurrent users', status: 'APPROVED' }
  ];

  it('fails if there are fewer than 2 acceptance criteria', () => {
    const draft = { acceptanceCriteria: [{ id: '1', text: 'Be fast', status: 'PENDING' }] };
    const result = validatePrdDraft(draft);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Minimum 2 acceptance criteria required');
  });

  it('fails if ACs contain vague terms', () => {
    const draft = { acceptanceCriteria: [{ id: '1', text: 'Make it fast', status: 'PENDING' }, { id: '2', text: 'Be secure', status: 'PENDING' }] };
    const result = validatePrdDraft(draft);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('AC 1 contains vague term: fast');
  });

  it('passes if requirements are specific and count is sufficient', () => {
    const draft = { acceptanceCriteria: validACs };
    const result = validatePrdDraft(draft);
    expect(result.isValid).toBe(true);
  });
});
- Item

- **File Path:** src/store/__tests__/workflow-store.test.ts
##### Content

import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowStore } from '../workflow-store';

describe('Workflow State Machine', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      currentStage: 'CAPTURE',
      intentAnchor: null,
      isValidated: false
    });
  });

  it('starts in CAPTURE stage', () => {
    const state = useWorkflowStore.getState();
    expect(state.currentStage).toBe('CAPTURE');
  });

  it('transitions to REFINE when intent anchor is established', () => {
    useWorkflowStore.getState().setIntentAnchor('Build a chat bot');
    expect(useWorkflowStore.getState().currentStage).toBe('REFINE');
    expect(useWorkflowStore.getState().intentAnchor).toBe('Build a chat bot');
  });

  it('blocks transition to REVIEW if validation fails', () => {
    const store = useWorkflowStore.getState();
    store.setStage('REFINE');
    
    // Attempt transition without validation
    store.requestReview(); 
    expect(useWorkflowStore.getState().currentStage).toBe('REFINE');
  });

  it('transitions to REVIEW when validation passes', () => {
    const store = useWorkflowStore.getState();
    store.setStage('REFINE');
    
    // Mock successful validation
    useWorkflowStore.setState({ isValidated: true });
    
    store.requestReview();
    expect(useWorkflowStore.getState().currentStage).toBe('REVIEW');
  });
});