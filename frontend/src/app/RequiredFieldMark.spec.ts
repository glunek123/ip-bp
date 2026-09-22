import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import RequiredFieldMark from './RequiredFieldMark.vue';

describe('RequiredFieldMark', () => {
  it('renders a visual star and an accessible required label', () => {
    const wrapper = mount(RequiredFieldMark);

    expect(wrapper.get('[aria-hidden="true"]').text()).toBe('*');
    expect(wrapper.get('.sr-only').text()).toBe('必填');
  });
});
