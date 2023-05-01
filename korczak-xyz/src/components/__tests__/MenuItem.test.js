import React from 'react'
import { render, screen } from '@testing-library/react'
import { BrowserRouter as Router } from 'react-router-dom'
import MenuItem from '../MenuItem'

describe('MenuItem', () => {
  test('renders MenuItem component with given props', () => {
    render(
      <Router>
        <MenuItem className="test-class" name="Test Name" to="/test-url" />
      </Router>
    )

    const menuItem = screen.getByText('Test Name')
    expect(menuItem).toBeInTheDocument()
    expect(menuItem).toHaveClass('test-class')
    expect(menuItem).toHaveAttribute('href', '/test-url')
  })
})