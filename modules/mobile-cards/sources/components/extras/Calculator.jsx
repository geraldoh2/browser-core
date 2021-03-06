import React from 'react';
import { StyleSheet, View, Text } from 'react-native';

import { getMessage } from '../../../core/i18n';
import Title from '../partials/Title';
import TapToCopy from '../partials/TapToCopy';
import Link from '../Link';
import { elementSideMargins } from '../../styles/CardStyle';

export default class extends React.Component {

  render() {
    const data = this.props.data;
    const Container = data.ez_type ? View : TapToCopy; // copy only calculator answers
    let title = getMessage(data.ez_type ? data.ez_type : 'calculator');
    if (data.location) {
      title += ` ${data.location}`;
    }
    return <Container val={data.answer}>
      <Title title={title} />
      <View style={styles.content}>
        <Text style={{ fontSize: 18, color: 'black' }}>{data.answer}</Text>
        <Text style={{ fontSize: 14, color: 'black' }}>{data.expression}</Text>
      </View>
    </Container>
  }
}

const styles = StyleSheet.create({
  content: {
    marginTop: 10,
    ...elementSideMargins,
  }
});
