import React from 'react'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/extend-expect'
import Header from './Header'

describe('Header component', () => {
    test('it renders with the given title', () => {
        const testTitle = 'Test header title'

        render(<Header title={testTitle} />)
        const titleElement = screen.getByText(testTitle)

        expect(titleElement).toBeInTheDocument()
    })
})